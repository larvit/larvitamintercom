'use strict';

const	EventEmitter	= require('events').EventEmitter,
	topLogPrefix	= 'larvitamintercom: index.js: ',
	uuidLib	= require('uuid'),
	bramqp	= require('bramqp'),
	{ Log, Utils }	= require('larvitutils'),
	lUtils	= new Utils(),
	async	= require('async'),
	url	= require('url'),
	net	= require('net');

/**
 * Intercom
 *
 * Exposed stuff on object:
 * socket - the network socket that speaks to RabbitMQ
 * handle - return from bramqp.initialize() used to do lots of stuff
 *
 * Events
 * .on('error', function (err)) - something serious happened!
 *
 * @param str options - AMQP connection string OR "loopback interface" to only work in loopback mode
 * or
 * @param obj options - {'conStr': 'see above', 'log': instance of log object}
 */
function Intercom(options) {
	const that	= this;

	let	logPrefix	= topLogPrefix + 'Intercom() - ',
		parsedConStr;

	if (typeof options === 'string') {
		options	= {'conStr': options};
	}

	if ( ! options.log) {
		options.log	= new Log();
	}

	parsedConStr	= url.parse(options.conStr);
	that.options	= options;
	that.log	= that.options.log;
	that.channelName	= 1;
	that.cmdQueue	= [];
	that.conStr	= options.conStr;
	that.declaredExchanges	= [];
	that.expectingClose	= false;
	that.queueReady	= false;
	that.sendInProgress	= false;
	that.sendQueue	= [];
	that.uuid	= uuidLib.v4();
	that.boundQueues	= []; // list of queues that is bound so to limit network talk
	that.declaredQueues	= []; // list of queues that is declared to limit network talk

	logPrefix += 'uuid: ' + that.uuid + ' - ';

	if (that.options.conStr === 'loopback interface') {
		that.loopback	= true;
		that.loopbackConQueue	= {};
		that.handle	= new EventEmitter;

		that.log.verbose(logPrefix + 'Initializing on loopback interface');

		that.initializeListeners();
	} else {
		that.loopback	= false;
		that.host	= parsedConStr.hostname;
		that.port	= parsedConStr.port || 5672;

		function openSocket() {
			let connectionOptions = {
				'port': that.port,
				'host':	that.host
			};

			that.log.info(logPrefix + 'Initializing socket on ' + that.host + ':' + that.port);


			that.socket = net.connect(connectionOptions);


			that.socket.setKeepAlive = true;

			that.socket.on('connect', function () {
				that.log.verbose(logPrefix + 'Socket connected to ' + that.host + ':' + that.port);

				onSocketConnect(function (err) {
					if (err) {
						that.log.error(logPrefix + ' Couldn\'t Initialize connection to rabbitmq');
					}

					that.initializeListeners();
				});
			});

			that.socket.on('error', function (err) {
				if (that.expectingClose !== false) {
					that.log.verbose(logPrefix + 'expected socket close, but also got socket error: ' + err.message);
				} else {
					that.log.error(logPrefix + 'socket error: ' + err.message);
				}
			});

			that.socket.on('close', function (err) {
				that.socket.destroy();
				that.socket.unref();

				if (that.expectingClose !== false) {
					that.log.verbose(logPrefix + 'socket closed with error, err: ' + err.message);
				} else {
					that.log.error(logPrefix + 'socket closed with error, err: ' + err.message);
					setTimeout(openSocket, 1000);
				}
			});

			that.socket.on('end', function () {
				that.log.info(logPrefix + 'socket connection ended by remote');
			});
		}

		function onSocketConnect(cb) {
			const tasks = [];

			// Create handle by socket connect to rabbitmq
			tasks.push(function (cb) {
				bramqp.initialize(that.socket, 'rabbitmq/full/amqp0-9-1.stripped.extended', function (err, result) {
					if (err) {
						that.log.error(logPrefix + 'Error connecting to ' + that.host + ':' + that.port + ' err: ' + err.message);
						that.emit('error', err);
					}

					// log.silly(logPrefix + 'bramqp.initialize() ran on ' + that.host + ':' + that.port);

					that.handle	= result;

					cb(err);
				});
			});

			// Open AMQP communication
			tasks.push(function (cb) {
				const	heartBeat	= true,
					auth	= parsedConStr.auth;

				let	username,
					password;

				if (auth) {
					username	= parsedConStr.auth.split(':')[0];
					password	= parsedConStr.auth.split(':')[1];
				}

				that.log.debug(logPrefix + 'openAMQPCommunication running on ' + that.host + ':' + that.port + ' with username: ' + username);

				that.handle.openAMQPCommunication(username, password, heartBeat, function (err) {
					if (err) {
						that.log.error(logPrefix + 'Error opening AMQP communication: ' + err.message);
						that.emit('error', err);
					}

					cb(err);
				});
			});

			async.series(tasks, function (err) {
				if (err) return cb(err);
				cb();
			});
		};

		openSocket();
	}
}

Intercom.prototype.initializeListeners = function () {
	const tasks = [],
		that = this,
		logPrefix = topLogPrefix + 'initializeListeners() - ';

	// Register listener for incoming messages
	tasks.push(function (cb) {
		that.handle.on(that.channelName + ':basic.deliver', function (channel, method, data) {
			const	exchange	= data.exchange,
				deliveryTag	= data['delivery-tag'],
				consumerTag	= data['consumer-tag'];

			// log.silly(logPrefix + 'Incoming message. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '"');

			that.handle.once('content', function (channel, className, properties, content) {
				let	message;

				// log.silly(logPrefix + 'Incoming message content. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');

				try {
					message = JSON.parse(content.toString());
				} catch (err) {
					that.log.warn(logPrefix + 'subscribe() - Could not parse incoming message. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');
					return;
				}

				if (lUtils.formatUuid(message.uuid) === false) {
					that.log.warn(logPrefix + 'consume() - Message does not contain uuid. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');
				}

				that.emit('incoming_msg_' + exchange, message, deliveryTag);
			});
		});
		cb();
	});


	tasks.push(function (cb) {
		that.handle.on('error', function (err) {
			that.log.error(logPrefix + 'RabbitMQ connection error :' + err.message);
		});
		cb();
	});

	// Register listener for close events
	tasks.push(function (cb) {
		that.handle.on('connection.close', function (channel, method, data) {
			if (that.expectingClose === false) {
				that.log.error(logPrefix + 'Unexpected connection.close! channel: "' + channel + '" data: "' + JSON.stringify(data) + '"');
			} else {
				that.log.info(logPrefix + 'Expected connetion.close. channel: "' + channel + '" data: "' + JSON.stringify(data) + '"');
			}
		});
		cb();
	});

	// Log all handle events
	// Should be disabled in production code and only manually enabled while debugging due to it being expensive
	/** /tasks.push(function (cb) {
		const	oldEmitter	= that.handle.emit;

		that.handle.emit = function () {
			const	emitArgs	= arguments;

			that.log.silly(topLogPrefix + 'handle.on("' + arguments[0] + '"), all arguments: "' + JSON.stringify(arguments) + '"');

			oldEmitter.apply(that.handle, arguments);
		}

		cb();
	});/**/

	// Construct generic handle comms
	tasks.push(function (cb) {
		const	cmdStrsWithoutOk	= ['basic.publish', 'content', 'closeAMQPCommunication', 'basic.nack', 'basic.ack', 'basic.qos'];

		that.handle.cmd = function cmd(cmdStr, params, cb) {
			if (typeof cb !== 'function') {
				cb = function () {};
			}

			that.cmdQueue.push({'cmdStr': cmdStr, 'params': params, 'cb': cb});

			// log.silly(logPrefix + 'handle.cmd() - cmdStr: "' + cmdStr + '" added to run queue. params: "' + JSON.stringify(params) + '"');

			if (that.cmdInProgress === true) {
				// log.silly(logPrefix + 'handle.cmd() - cmdStr: "' + cmdStr + '" cmdInProgress === true');
				return;
			}

			// log.silly(logPrefix + 'handle.cmd() - cmdStr: "' + cmdStr + '" cmdInProgress !== true');

			that.cmdInProgress = true;

			function readFromQueue() {
				const	mainParams	= that.cmdQueue.shift(),
					cmdStr	= mainParams.cmdStr,
					tasks	= [],
					cb	= mainParams.cb;

				let	params	= mainParams.params,
					channel,
					method,
					data;

				if ( ! Array.isArray(params)) {
					params = [];
				}

				// Register the callback
				tasks.push(function (cb) {
					const	cmdGroupName	= cmdStr.split('.')[0],
						cmdName	= cmdStr.split('.')[1];

					let	callCb	= true,
						okTimeout;

					function cmdCb(err) {
						if (err) {
							that.log.error(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" failed, err: ' + err.message);
							callCb = false;
							return cb(err);
						}

						// log.silly(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" succeeded');

						if (cmdStrsWithoutOk.indexOf(cmdStr) !== - 1) {
							return cb();
						}
					}

					if (that.loopback === true) {
						return cb();
					}

					if (cmdStrsWithoutOk.indexOf(cmdStr) === - 1 && that.loopback === false) {
						okTimeout = setTimeout(function () {
							const	err	= new Error('no answer received from queue within 10s');
							that.log.error(topLogPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", ' + err.message);
							callCb	= false;
							cb(err);
						}, 10000);

						that.handle.once(that.channelName + ':' + cmdStr + '-ok', function (x, y, z) {
							// We want these in the outer scope, thats why the weird naming
							channel	= x;
							method	= y;
							data	= z;

							// log.silly(topLogPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", answer received from queue');
							if (callCb === false) {
								that.log.warn(topLogPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", answer received but to late; timeout have already happened');
								return;
							}
							clearTimeout(okTimeout);
							cb();
						});
					}

					params.push(cmdCb);

					if (cmdName) {
						that.handle[cmdGroupName][cmdName].apply(that.handle, params);
					} else {
						that.handle[cmdGroupName].apply(that.handle, params);
					}
				});

				async.series(tasks, function (err) {
					cb(err, channel, method, data);

					if (that.cmdQueue.length === 0) {
						// log.silly(topLogPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" cmdQueue.length === 0');
						that.cmdInProgress = false;
					} else {
						// log.silly(topLogPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" readFromQueue() rerunning');
						readFromQueue();
					}
				});
			}
			readFromQueue();
		};
		cb();
	});

	// Set QoS to 10
	tasks.push(function (cb) {
		const	prefetchSize	= 0,
			prefetchCount	= 10,
			global	= true;

		that.handle.cmd('basic.qos', [that.channelName, prefetchSize, prefetchCount, global], function (err) {
			that.log.verbose(logPrefix + 'basic.qos set to: "' + prefetchCount + '"');
			cb(err);
		});
	});

	async.series(tasks, function (err) {
		if ( ! err) {
			if (that.loopback === true) {
				that.log.verbose(logPrefix + 'Initialized on loopback interface');
			} else {
				that.log.verbose(logPrefix + 'Initialized on ' + that.host + ':' + that.port);
			}
			that.queueReady	= true;
			setImmediate(function () {
				that.emit('ready');
			});
		}
	});
};

// Make Intercom an event emitter
Intercom.prototype.__proto__ = EventEmitter.prototype;

Intercom.prototype.bindQueue = function (queueName, exchange, cb) {
	const	logPrefix	= topLogPrefix + 'Intercom.prototype.bindQueue() - conUuid: ' + this.uuid + ' - ',
		noWait	= false,	//	"If set, the server will not respond to the method. The client
		//			should not wait for a reply method. If the server could not complete
		//			the method it will raise a channel or connection exception."
		//			- https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.bind.arguments
		that	= this;

	if (that.boundQueues[queueName + '___' + exchange] === true) return cb();

	that.log.debug(logPrefix + 'Binding queue "' + queueName + '" to exchange "' + exchange + '"');

	if (that.loopback === true) return cb();

	that.ready(function (err) {
		if (err) return cb(err);

		that.handle.cmd('queue.bind', [that.channelName, queueName, exchange, 'ignored-routing-key', noWait, args], function (err) {
			if (err) {
				that.log.error(logPrefix + 'Could not bind queue: "' + queueName + '" to exchange: "' + exchange + '", err: ' + err.message);
			}

			that.boundQueues[queueName + '___' + exchange]	= true;
			// log.silly(logPrefix + 'Bound queue "' + queueName + '" to exchange "' + exchange + '"');

			cb(err);
		});
	});
};

// Close the RabbitMQ connection
Intercom.prototype.close = function (cb) {
	const	logPrefix	= topLogPrefix + 'close() - conUuid: ' + this.uuid + ' - ',
		that	= this;

	if (typeof cb !== 'function') {
		cb = function () {};
	}

	if (that.loopback === true) {
		that.log.verbose(logPrefix + 'on loopback interface');
		return cb();
	} else {
		that.log.verbose(logPrefix + 'on ' + that.host + ':' + that.port);
	}

	that.expectingClose	= true;

	that.ready(function (err) {
		if (err) return cb(err);

		that.handle.closeAMQPCommunication(function (err) {
			if (err) {
				that.log.warn(logPrefix + 'Could not closeAMQPCommunication: ' + err.message);
				return cb(err);
			}

			setImmediate(function () {
				that.log.verbose(logPrefix + 'closed ' + that.host + ':' + that.port);
				cb();
			});
		});
	});
};

Intercom.prototype.consume = function (options, msgCb, cb) {
	const	logPrefix	= topLogPrefix + 'Intercom.prototype.consume() - conUuid: ' + this.uuid + ' - ',
		that	= this;

	if (typeof options === 'function') {
		cb	= msgCb;
		msgCb	= options;
		options	= {};
	}

	if (options.exclusive !== true && options.exclusive !== false) {
		options.exclusive	= false;
	}

	options.type	= 'consume';

	if (options.exchange === undefined) {
		options.exchange	= 'default';
	}

	if (that.loopback === true) {
		if (Array.isArray(that.loopbackConQueue[options.exchange])) {
			setTimeout(function () {
				for (let i = 0; that.loopbackConQueue[options.exchange][i] !== undefined; i ++) {
					const	queueItem	= that.loopbackConQueue[options.exchange][i];

					queueItem.options.ignoreConQueue = true;

					that.send(queueItem.orgMsg, queueItem.options);
				}

				that.loopbackConQueue[options.exchange] = 'connected';
			}, 10);
		}
	}

	that.log.verbose(logPrefix + 'Starting on exchange "' + options.exchange + '"');

	this.genericConsume(options, msgCb, cb);
};

Intercom.prototype.declareExchange = function (exchangeName, cb) {
	const	exchangeType	= 'fanout',
		autoDelete	= false,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.auto-delete
		logPrefix	= topLogPrefix + 'Intercom.prototype.declareExchange() - conUuid: ' + this.uuid + ' - exchangeName: "' + exchangeName + '" - ',
		internal	= false,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.internal
		passive	= false,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.passive
		durable	= true,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.durable
		noWait	= false,	//	"If set, the server will not respond to the method. The client should not wait
		//			for a reply method. If the server could not complete the method it will raise
		//			a channel or connection exception." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.arguments
		that	= this;

	// log.silly(logPrefix);

	if (that.loopback === true) return cb();

	that.ready(function (err) {
		if (err) return cb(err);

		if (that.declaredExchanges.indexOf(exchangeName) !== - 1) {
			// log.silly(logPrefix + 'Already declared.');
			return cb();
		}

		that.log.debug(logPrefix + 'Declaring');

		that.handle.cmd('exchange.declare', [that.channelName, exchangeName, exchangeType, passive, durable, autoDelete, internal, noWait, args], function (err) {
			if (err) {
				that.log.warn(logPrefix + 'Could not declare exchange, err: ' + err.message);
				return cb(err);
			}

			// log.silly(logPrefix + 'Declared!');

			that.declaredExchanges.push(exchangeName);
			cb(err);
		});
	});
};

/**
 * Declare a queue
 *
 * @param obj options -	{
		'queueName':	str,	// if left out will be auto generated
		'exclusive':	boolean,	// default: false, https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.exclusive
 *	}
 * @param func cb(err, queueName)
 */
Intercom.prototype.declareQueue = function (options, cb) {
	const	autoDelete	= false,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.auto-delete
		passive	= false,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.passive
		durable	= (options.durable === undefined) ? true : options.durable,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.durable
		noWait	= false,	//	"If set, the server will not respond to the method. The client should not
		//			wait for a reply method. If the server could not complete the method it will
		//			raise a channel or connection exception." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.arguments
		that	= this;

	let	logPrefix	= topLogPrefix + 'Intercom.prototype.declareQueue() - conUuid: ' + this.uuid + ' - ',
		queueKey;

	if ( ! options.queueName)	{ options.queueName	= '';	}
	if (options.exclusive === undefined)	{ options.exclusive	= false;	}

	logPrefix += 'queueName: "' + options.queueName + '" - exclusive: ' + options.exclusive.toString() + ' - ';

	queueKey = String(that.channelName);
	queueKey += options.queueName;
	queueKey += String(options.exclusive);
	queueKey += String(passive);
	queueKey += String(durable);
	queueKey += JSON.stringify(args);

	if (autoDelete === false && that.declaredQueues[queueKey] === true && options.queueName !== '') {
		return cb(null, options.queueName);
	}

	that.log.debug(logPrefix + 'Declaring');

	if (that.loopback === true) {
		if (options.queueName === '') {
			options.queueName	= 'amq.gen-' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(10);
		}

		return cb(null, options.queueName);
	}

	that.ready(function (err) {
		if (err) return cb(err);

		that.handle.cmd('queue.declare', [that.channelName, options.queueName, passive, durable, options.exclusive, autoDelete, noWait, args], function (err, channel, method, data) {
			let	queueName;

			if (err) {
				that.log.error(logPrefix + 'Could not declare queue, err: ' + err.message);
				return cb(err);
			}

			if (options.queueName !== '') {
				that.declaredQueues[queueKey]	= true;
			}
			queueName	= data.queue;
			// log.silly(logPrefix + 'Declared!');
			cb(err, queueName);
		});
	});
};

/* Not working!
Intercom.prototype.deleteQueue = function (queueName, cb) {
	const	ifUnused	= false,	// If set, the server will only delete the queue if it
				// has no consumers. If the queue has consumers the
				// server does does not delete it but raises a channel
				// exception instead.
		ifEmpty	= false,	// If set, the server will only delete the queue if it
				// has no messages.
		noWait	= false;	// If set, the server will not respond to the method.
				// The client should not wait for a reply method. If
				// the server could not complete the method it will
				// raise a channel or connection exception.

	if (typeof cb !== 'function') {
		cb = function () {};
	}

	that.handle.queue.delete(that.channelName, queueName, ifUnused, ifEmpty, noWait);
	that.handle.once(that.channelName + ':queue.delete-ok', function (channel, method, data) {
		that.log.verobse(topLogPrefix + 'deleteQueue() - queue "' + queueName + '", containing "' + data['message-count'] + '" deleted.');
		cb();
	});
};*/

Intercom.prototype.genericConsume = function (options, msgCb, cb) {
	const	returnObj	= {},
		logPrefix	= topLogPrefix + 'Intercom.prototype.genericConsume() - ',
		tasks	= [],
		that	= this;

	let	queueName;

	if (cb === undefined) {
		cb	= function () {};
	}

	if (options.exchange === undefined) {
		options.exchange	= 'default';
	}

	if (options.type === 'subscribe') {
		options.exclusive	= false;
	}

	queueName	= 'queTo_' + options.exchange;

	/* This cancels subscription to all queues and exchanges on the current connection... we obviously do not want that so it is disabled atm
	returnObj.cancel = function cancel(cb) {
		if (typeof cb !== 'function') {
			cb = function () {};
		}

		if (returnObj.data === undefined || returnObj.data['consumer-tag'] === undefined) {
			const	err = new Error('No consumer tag is defined, consume have probably not been started yet.');
			that.log.warn(topLogPrefix + 'genericConsume() - cancel() - ' + err.message);
			cb(err);
			return;
		}

		that.handle.basic.cancel(returnObj.data['consumer-tag'], function (err) {
			if (err) {
				that.log.warn(topLogPrefix + 'genericConsume() - cancel() - Could not canceled consuming. consumer-tag: "' + returnObj.data['consumer-tag'] + '", err: ' + err.message);
			} else {
				that.log.verbose(topLogPrefix + 'genericConsume() - cancel() - Canceled consuming. consumer-tag: "' + returnObj.data['consumer-tag'] + '"');
			}

			cb(err);
		});
		// We could not get this to work :( // Lilleman and gagge 2016-12-27
		//that.handle.once(that.channelName + ':basic.cancel-ok', function (channel, method, data) {
		//	that.log.verbose(topLogPrefix + 'consume() - cancel() - Canceled consuming.');
		//	that.log.debug(topLogPrefix + 'consume() - cancel() - Canceled consuming. channel: ' + JSON.stringify(channel));
		//	that.log.debug(topLogPrefix + 'consume() - cancel() - Canceled consuming. method: ' + JSON.stringify(method));
		//	that.log.debug(topLogPrefix + 'consume() - cancel() - Canceled consuming. data: ' + JSON.stringify(data));
		//	cb();
		//});
	};*/

	// Declare exchange
	tasks.push(function (cb) {
		that.declareExchange(options.exchange, cb);
	});

	// Declare queue
	tasks.push(function (cb) {
		if (options.type === 'consume') {
			that.declareQueue({'queueName': queueName}, cb);
		} else if (options.type === 'subscribe') {
			that.declareQueue({'exclusive': true}, function (err, result) {
				queueName	= result;

				if ( ! queueName) {
					const	err	= new Error('Did not get a queueName from AMQP server when trying that.declareQueue');
					that.log.error(logPrefix + err.message);
					return cb(err);
				}

				cb(err);
			});
		} else {
			that.log.error(logPrefix + 'Options.type must be "consume" or "subscribe", but is: "' + options.type + '"');
		}
	});

	// Bind queue
	tasks.push(function (cb) {
		that.bindQueue(queueName, options.exchange, cb);
	});

	// Start consuming
	tasks.push(function (cb) {
		const	consumerTag	= null,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#basic.consume.consumer-tag
			noLocal	= false,	//	"If the no-local field is set the server will not send messages to the connection
			//			that published them." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
			noWait	= false,	//	"If set, the server will not respond to the method. The client should not wait
			//			for a reply method. If the server could not complete the method it will raise a
			//			channel or connection exception." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
			noAck	= false,	//	"If this field is set the server does not expect acknowledgements for messages.
			//			That is, when a message is delivered to the client the server assumes the delivery
			//			will succeed and immediately dequeues it. This functionality may increase performance
			//			but at the cost of reliability. Messages can get lost if a client dies before they
			//			are delivered to the application." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
			exclusive	= options.exclusive,	//	Request exclusive consumer access, meaning only this consumer can access the queue.
			args	= {};	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#basic.consume.arguments

		// No need to send a command on the queue for the loopback, handle this directly in the send function
		if (that.loopback === true) return cb();

		that.handle.cmd('basic.consume', [that.channelName, queueName, consumerTag, noLocal, noAck, exclusive, noWait, args], function (err, channel, method, data) {
			let	consumerTag;

			if (err) return cb(err);

			returnObj.channel	= channel;
			returnObj.method	= method;
			returnObj.data	= data;

			if (data !== undefined && data['consumer-tag'] !== undefined) {
				consumerTag = data['conumer-tag'];
			} else {
				that.log.warn(logPrefix + 'No consumerTag obtained for queue: "' + queueName + '"');
			}

			that.log.verbose(logPrefix + 'Started consuming on queue: "' + queueName + '" with consumer tag: "' + consumerTag + '"');
			cb();
		});
	});

	// Register msgCb
	tasks.push(function (cb) {
		const	eventName	= 'incoming_msg_' + options.exchange;

		if (that.listenerCount(eventName) !== 0) {
			const	err	= new Error('Only one subscribe or consume is allowed for each exchange. exchange: "' + options.exchange + '"');
			that.log.warn(topLogPrefix + 'genericConsume() - ' + err.message);
			return cb(err);
		}

		that.on(eventName, function (message, deliveryTag) {
			msgCb(message, function (err) {
				if (err) {
					that.log.warn(logPrefix + 'nack on deliveryTag: "' + deliveryTag + '" err: ' + err.message);
					that.handle.cmd('basic.nack', [that.channelName, deliveryTag]);
				} else {
					// log.silly(logPrefix + 'ack on deliveryTag: "' + deliveryTag + '"');
					that.handle.cmd('basic.ack', [that.channelName, deliveryTag]);
				}
			}, deliveryTag);
		});

		cb();
	});

	async.series(tasks, function (err) {
		if (err) return cb(err);

		cb(err, returnObj);
	});
};

Intercom.prototype.ready = function (cb) {
	if (this.queueReady === true) return cb();

	this.on('ready', cb);
};

/**
 * Send something
 *
 * @param obj message	- message will be appended with an uuid if that does not exist
 * @param obj options	- { OPTIONAL
 *			'exchange':	str,	// Default: "default"
 *			'durable':	boolean,	// Default: true
 *			'forceConsumeQueue':	boolean,	// Default: false - will create a consume-queue even if there currently are no listeners
 *			'ignoreConQueue':	boolean,	// Default: undefined - will ignore the consume queue for loopback interfaces
 *		}
 * @param func cb(err, message assigned uuid)
 */
Intercom.prototype.send = function (orgMsg, options, cb) {
	const	logPrefix	= topLogPrefix + 'Intercom.prototype.send() - ',
		message	= require('util')._extend({}, orgMsg),
		that	= this,
		tasks	= [];

	let	cbsRan	= 0,
		stringifiedMsg,
		msgUuid,
		cbErr;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (cb === undefined) {
		cb = function () {};
	}

	if (options.exchange === undefined) {
		options.exchange	= 'default';
	}

	if (message.uuid === undefined) {
		message.uuid = uuidLib.v4();
	}

	msgUuid	= message.uuid;

	try {
		stringifiedMsg	= JSON.stringify(message);
	} catch (err) {
		that.log.warn(logPrefix + 'Could not stringify message. Message attached to next log call.');
		that.log.warn(logPrefix + 'Unstringifiable message attached:', message);
		return cb(err);
	}

	//log.silly(logPrefix + 'Sending to exchange: "' + options.exchange + '", uuid: "' + message.uuid + '", message: "' + stringifiedMsg + '"');

	if (that.loopback === true) {
		if (
			options.forceConsumeQueue	=== true
			&& that.loopbackConQueue[options.exchange]	!== 'connected'
			&& options.ignoreConQueue	!== true
		) {
			const	newOrgMsg	= JSON.parse(JSON.stringify(orgMsg));

			if (that.loopbackConQueue[options.exchange] === undefined) {
				that.loopbackConQueue[options.exchange]	= [];
			}

			newOrgMsg.uuid = msgUuid;
			that.loopbackConQueue[options.exchange].push({'orgMsg': newOrgMsg, 'options': options});

			return cb(null, msgUuid);
		}

		that.emit('incoming_msg_' + options.exchange, message, uuidLib.v4());

		return cb(null, msgUuid);
	}

	// Declare exchange
	tasks.push(function (cb) {
		that.declareExchange(options.exchange, cb);
	});

	if (options.forceConsumeQueue === true) {
		const	queueName	= 'queTo_' + options.exchange;

		// Declare queue
		tasks.push(function (cb) {
			that.declareQueue({'queueName': queueName}, cb);
		});

		// Bind queue
		tasks.push(function (cb) {
			that.bindQueue(queueName, options.exchange, cb);
		});
	}

	tasks.push(function (cb) {
		const	properties	= {'content-type': 'application/json'},
			className	= 'basic',
			mandatory	= true,
			immediate	= false;

		that.handle.cmd('basic.publish', [that.channelName, options.exchange, 'ignored-routing-key', mandatory, immediate], function (err) {
			if (err) {
				that.log.warn(logPrefix + 'Could not publish to exchange: "' + options.exchange + '". err: ' + err.message + ', uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');
				if ( ! cbErr) {
					cbErr	= err;
					cb(err);
				}
				return;
			}

			// log.silly(logPrefix + 'Published (no content sent) to exchange: "' + options.exchange + '", uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');

			cbsRan ++;
			if (cbsRan === 2 && ! cbErr) {
				cb(null);
			}
		});

		that.handle.cmd('content', [that.channelName, className, properties, stringifiedMsg], function (err) {
			if (err) {
				that.log.warn(logPrefix + 'Could not send publish content to exchange: "' + options.exchange + '". err: ' + err.message + ', uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');
				if ( ! cbErr) {
					cbErr	= err;
					cb(err);
				}
				return;
			}

			// log.silly(logPrefix + 'Content sent to exchange: "' + options.exchange + '", uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');

			cbsRan ++;
			if (cbsRan === 2 && ! cbErr) {
				cb(null);
			}
		});
	});

	async.series(tasks, function (err) {
		cb(err, message.uuid);
	});
};

Intercom.prototype.subscribe = function (options, msgCb, cb) {
	const	logPrefix	= topLogPrefix + 'Intercom.prototype.subscribe() - conUuid: ' + this.uuid + ' - ',
		that	= this;

	if (typeof options === 'function') {
		cb	= msgCb;
		msgCb	= options;
		options	= {};
	}

	options.type	= 'subscribe';

	if (options.exchange === undefined) {
		options.exchange	= 'default';
	}

	that.log.verbose(logPrefix + 'Starting on exchange "' + options.exchange + '"');

	this.genericConsume(options, msgCb, cb);
};

exports = module.exports = Intercom;
