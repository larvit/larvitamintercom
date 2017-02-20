'use strict';

const	EventEmitter	= require('events').EventEmitter,
	logPrefix	= 'larvitamintercom: ',
	uuidLib	= require('uuid'),
	bramqp	= require('bramqp'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
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
 * .on('error', function(err)) - something serious happened!
 *
 * @param str conStr - AMQP connection string OR "loopback interface" to only work in loopback mode
 */
function Intercom(conStr) {
	const	parsedConStr	= url.parse(conStr),
		thisLogPrefix	= logPrefix + 'Intercom() - ',
		tasks	= [],
		that	= this;

	that.channelName	= 1;
	that.cmdQueue	= [];
	that.conStr	= conStr;
	that.declaredExchanges	= [];
	that.sendInProgress	= false;
	that.sendQueue	= [];
	that.expectingClose	= false;
	that.queueReady	= false;

	if (conStr === 'loopback interface') {
		that.loopback	= true;
		that.handle	= new EventEmitter;

		log.verbose(thisLogPrefix + 'Initializing on loopback interface');
	} else {
		that.loopback	= false;
		that.host	= parsedConStr.hostname;
		that.port	= parsedConStr.port || 5672;

		that.socket = net.connect({
			'port': that.port,
			'host':	that.host
		});

		log.verbose(thisLogPrefix + 'Initializing on ' + that.host + ':' + that.port);

		that.socket.on('error', function(err) {
			log.error(thisLogPrefix + 'socket error: ' + err.message);
		});

		that.socket.on('close', function(hadError) {
			log.info(thisLogPrefix + 'socket closed');
			if (hadError) {
				log.error(thisLogPrefix + 'socket closed with error');
			}
		});

		that.socket.on('end', function() {
			log.info(thisLogPrefix + 'socket connection ended by remote');
		});

		// Create handle by socket connect to rabbitmq
		tasks.push(function(cb) {
			bramqp.initialize(that.socket, 'rabbitmq/full/amqp0-9-1.stripped.extended', function(err, result) {
				if (err) {
					log.error(thisLogPrefix + 'Error connecting to ' + that.host + ':' + that.port + ' err: ' + err.message);
					that.emit('error', err);
				}

				log.debug(thisLogPrefix + 'bramqp.initialize() ran on ' + that.host + ':' + that.port);

				that.handle = result;

				cb(err);
			});
		});

		// Open AMQP communication
		tasks.push(function(cb) {
			const	heartBeat	= true,
				auth	= parsedConStr.auth;

			let	username,
				password;

			if (auth) {
				username	= parsedConStr.auth.split(':')[0];
				password	= parsedConStr.auth.split(':')[1];
			}

			log.debug(thisLogPrefix + 'openAMQPCommunication running on ' + that.host + ':' + that.port + ' with username: ' + username);

			that.handle.openAMQPCommunication(username, password, heartBeat, function(err) {
				if (err) {
					log.error(thisLogPrefix + 'Error opening AMQP communication: ' + err.message);
					that.emit('error', err);
				}

				cb(err);
			});
		});
	}

	// Register listener for incoming messages
	tasks.push(function(cb) {
		that.handle.on(that.channelName + ':basic.deliver', function(channel, method, data) {
			const	exchange	= data.exchange,
				deliveryTag	= data['delivery-tag'],
				consumerTag	= data['consumer-tag'];

			log.debug(thisLogPrefix + 'Incoming message. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '"');

			that.handle.once('content', function(channel, className, properties, content) {
				let	message;

				log.debug(thisLogPrefix + 'Incoming message content. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');

				try {
					message = JSON.parse(content.toString());
				} catch(err) {
					log.warn(logPrefix + 'subscribe() - Could not parse incoming message. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');
					cb(err);
					return;
				}

				if (lUtils.formatUuid(message.uuid) === false) {
					log.warn(logPrefix + 'consume() - Message does not contain uuid. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');
				}

				that.emit('incoming_msg_' + exchange, message, deliveryTag);
			});
		});
		cb();
	});

	// Register listener for close events
	tasks.push(function(cb) {
		that.handle.on('connection.close', function(channel, method, data) {
			if (that.expectingClose === false) {
				log.error(thisLogPrefix + 'Unexpected connection.close! channel: "' + channel + '" data: "' + JSON.stringify(data) + '"');
			} else {
				log.info(thisLogPrefix + 'Expected connetion.close. channel: "' + channel + '" data: "' + JSON.stringify(data) + '"');
			}
		});
		cb();
	});

	// Log all handle events
	// Should be disabled in production code and only manually enabled while debugging due to it being expensive
	/** /tasks.push(function(cb) {
		const	oldEmitter	= that.handle.emit;

		that.handle.emit = function() {
			const	emitArgs	= arguments;

			log.silly(logPrefix + 'handle.on("' + arguments[0] + '"), all arguments: "' + JSON.stringify(arguments) + '"');

			oldEmitter.apply(that.handle, arguments);
		}

		cb();
	});/**/

	// Construct generic handle comms
	tasks.push(function(cb) {
		const	cmdStrsWithoutOk	= ['basic.publish', 'content', 'closeAMQPCommunication', 'basic.nack', 'basic.ack'];

		that.handle.cmd = function cmd(cmdStr, params, cb) {
			if (typeof cb !== 'function') {
				cb = function() {};
			}

			that.cmdQueue.push({'cmdStr': cmdStr, 'params': params, 'cb': cb});

			log.debug(logPrefix + 'handle.cmd() - cmdStr: "' + cmdStr + '" added to run queue. params: "' + JSON.stringify(params) + '"');

			if (that.cmdInProgress === true) {
				log.silly(logPrefix + 'handle.cmd() - cmdStr: "' + cmdStr + '" cmdInProgress === true');
				return;
			}

			log.silly(logPrefix + 'handle.cmd() - cmdStr: "' + cmdStr + '" cmdInProgress !== true');

			that.cmdInProgress = true;

			function readFromQueue() {
				const	mainParams	= that.cmdQueue.shift(),
					cmdStr	= mainParams.cmdStr,
					cb	= mainParams.cb,
					tasks	= [];

				let	params	= mainParams.params,
					channel,
					method,
					data;

				if ( ! Array.isArray(params)) {
					params = [];
				}

				// Register the callback
				tasks.push(function(cb) {
					const	cmdGroupName	= cmdStr.split('.')[0],
						cmdName	= cmdStr.split('.')[1];

					let	callCb	= true,
						okTimeout;

					if (cmdStrsWithoutOk.indexOf(cmdStr) === - 1) {
						okTimeout = setTimeout(function() {
							const	err	= new Error('no answer received from queue within 500ms');
							log.error(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", ' + err.message);
							callCb = false;
							cb(err);
						}, 500);

						that.handle.once(that.channelName + ':' + cmdStr + '-ok', function(x, y, z) {
							// We want these in the outer scope, thats why the weird naming
							channel	= x;
							method	= y;
							data	= z;

							log.debug(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", answer received from queue');
							if (callCb === false) {
								log.warn(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", answer received but to late; timeout have already happened');
								return;
							}
							clearTimeout(okTimeout);
							cb();
						});
					}

					params.push(function(err) {
						if (err) {
							log.error(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" failed, err: ' + err.message);
							callCb = false;
							cb(err);
							return;
						}

						log.debug(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" succeeded');

						if (cmdStrsWithoutOk.indexOf(cmdStr) !== - 1) {
							cb();
						}
					});

					if (that.loopback === true) {
						if (cmdStrsWithoutOk.indexOf(cmdStr) === - 1) {
							that.handle.emit(that.channelName + ':' + cmdStr + '-ok', that.channelName, cmdStr, 'blah');
						}
					} else if (cmdName) {
						that.handle[cmdGroupName][cmdName].apply(that.handle, params);
					} else {
						that.handle[cmdGroupName].apply(that.handle, params);
					}
				});

				async.series(tasks, function(err) {
					cb(err, channel, method, data);

					if (that.cmdQueue.length === 0) {
						log.silly(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" cmdQueue.length === 0');
						that.cmdInProgress = false;
					} else {
						log.silly(logPrefix + 'handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" readFromQueue() rerunning');
						readFromQueue();
					}
				});
			}
			readFromQueue();
		};
		cb();
	});

	async.series(tasks, function(err) {
		if ( ! err) {
			if (that.loopback === true) {
				log.debug(thisLogPrefix + 'Initialized on loopback interface');
			} else {
				log.debug(thisLogPrefix + 'Initialized on ' + that.host + ':' + that.port);
			}
			that.queueReady	= true;
			setImmediate(function() {
				that.emit('ready');
			});
		}
	});
}

// Make Intercom an event emitter
Intercom.prototype.__proto__ = EventEmitter.prototype;

Intercom.prototype.bindQueue = function(queueName, exchange, cb) {
	const	noWait	= false,	// "If set, the server will not respond to the method. The client
				// should not wait for a reply method. If the server could not complete
				// the method it will raise a channel or connection exception."
				// - https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.bind.arguments
		that	= this;

	log.verbose(logPrefix + 'bindQueue() - Binding queue "' + queueName + '" to exchange "' + exchange + '"');

	that.ready(function(err) {
		if (err) { cb(err); return; }

		that.handle.cmd('queue.bind', [that.channelName, queueName, exchange, 'ignored-routing-key', noWait, args], function(err) {
			if (err) {
				log.error(logPrefix + 'bindQueue() - Could not bind queue: "' + queueName + '" to exchange: "' + exchange + '", err: ' + err.message);
			}

			log.debug(logPrefix + 'bindQueue() - Bound queue "' + queueName + '" to exchange "' + exchange + '"');

			cb(err);
		});
	});
};

// Close the RabbitMQ connection
Intercom.prototype.close = function(cb) {
	const	that = this;

	if (typeof cb !== 'function') {
		cb = function() {};
	}

	log.verbose(logPrefix + 'close() - on ' + that.host + ':' + that.port);

	that.expectingClose = true;

	that.ready(function(err) {
		if (err) { cb(err); return; }

		that.handle.cmd('closeAMQPCommunication', function(err) {
			if (err) {
				log.warn(logPrefix + 'close() - Could not closeAMQPCommunication: ' + err.message);
				cb(err);
				return;
			}

			setImmediate(function() {
				log.debug(logPrefix + 'close() - closed ' + that.host + ':' + that.port);
				cb();
			});
		});
	});
};

Intercom.prototype.consume = function(options, msgCb, cb) {
	if (typeof options === 'function') {
		cb	= msgCb;
		msgCb	= options;
		options	= {};
	}

	if (options.exclusive !== true && options.exclusive !== false) {
		options.exclusive = false;
	}

	options.type = 'consume';

	if (options.exchange === undefined) {
		options.exchange	= 'default';
	}

	log.verbose(logPrefix + 'consume() - Starting on exchange "' + options.exchange + '"');

	this.genericConsume(options, msgCb, cb);
};

Intercom.prototype.declareExchange = function(exchangeName, cb) {
	const	exchangeType	= 'fanout',
		autoDelete	= false,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.auto-delete
		internal	= false,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.internal
		passive	= false,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.passive
		durable	= true,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.durable
		noWait	= false,	// "If set, the server will not respond to the method. The client should not wait
				// for a reply method. If the server could not complete the method it will raise
				// a channel or connection exception." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.arguments
		that	= this;

	log.debug(logPrefix + 'declareExchange() - exchangeName: "' + exchangeName + '"');

	that.ready(function(err) {
		if (err) { cb(err); return; }

		if (that.declaredExchanges.indexOf(exchangeName) !== - 1) {
			log.debug(logPrefix + 'declareExchange() - Already declared. exchangeName: "' + exchangeName + '"');
			cb();
			return;
		}

		log.verbose(logPrefix + 'declareExchange() - Declaring exchangeName: "' + exchangeName + '"');

		that.handle.cmd('exchange.declare', [that.channelName, exchangeName, exchangeType, passive, durable, autoDelete, internal, noWait, args], function(err) {
			if (err) {
				log.warn(logPrefix + 'declareExchange() - Could not declare exchange "' + exchangeName + '", err: ' + err.message);
				cb(err);
				return;
			}

			log.debug(logPrefix + 'declareExchange() - Declared! exchangeName: "' + exchangeName + '"');

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
Intercom.prototype.declareQueue = function(options, cb) {
	const	autoDelete	= false,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.auto-delete
		passive	= false,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.passive
		durable	= (options.durable === undefined) ? true : options.durable,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.durable
		noWait	= false,	//  "If set, the server will not respond to the method. The client should not
				// wait for a reply method. If the server could not complete the method it will
				// raise a channel or connection exception." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.arguments
		that	= this;

	if ( ! options.queueName)	{ options.queueName	= '';	}
	if (options.exclusive === undefined)	{ options.exclusive	= false;	}

	log.verbose(logPrefix + 'declareQueue() - Declaring queueName: "' + options.queueName + '" exclusive: ' + options.exclusive.toString());

	that.ready(function(err) {
		if (err) { cb(err); return; }

		that.handle.cmd('queue.declare', [that.channelName, options.queueName, passive, durable, options.exclusive, autoDelete, noWait, args], function(err, channel, method, data) {
			let queueName;

			if (err) {
				log.error(logPrefix + 'declareQueue() - Could not declare queue, name: "' + options.queueName + '" err: ' + err.message);
				cb(err);
				return;
			}

			queueName = data.queue;
			log.debug(logPrefix + 'declareQueue() - Declared! queueName: "' + queueName + '" exclusive: ' + options.exclusive.toString());
			cb(err, queueName);
		});
	});
};

/* Not working!
Intercom.prototype.deleteQueue = function(queueName, cb) {
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
		cb = function() {};
	}

	that.handle.queue.delete(that.channelName, queueName, ifUnused, ifEmpty, noWait);
	that.handle.once(that.channelName + ':queue.delete-ok', function(channel, method, data) {
		log.verobse(logPrefix + 'deleteQueue() - queue "' + queueName + '", containing "' + data['message-count'] + '" deleted.');
		cb();
	});
};*/

Intercom.prototype.genericConsume = function(options, msgCb, cb) {
	const	returnObj	= {},
		tasks	= [],
		that	= this;

	let	queueName;

	if (cb === undefined) {
		cb = function() {};
	}

	if (options.exchange === undefined) {
		options.exchange	= 'default';
	}

	if (options.type === 'subscribe') {
		options.exclusive = false;
	}

	queueName	= 'queTo_' + options.exchange;

	/* This cancels subscription to all queues and exchanges on the current connection... we obviously do not want that so it is disabled atm
	returnObj.cancel = function cancel(cb) {
		if (typeof cb !== 'function') {
			cb = function() {};
		}

		if (returnObj.data === undefined || returnObj.data['consumer-tag'] === undefined) {
			const	err = new Error('No consumer tag is defined, consume have probably not been started yet.');
			log.warn(logPrefix + 'genericConsume() - cancel() - ' + err.message);
			cb(err);
			return;
		}

		that.handle.basic.cancel(returnObj.data['consumer-tag'], function(err) {
			if (err) {
				log.warn(logPrefix + 'genericConsume() - cancel() - Could not canceled consuming. consumer-tag: "' + returnObj.data['consumer-tag'] + '", err: ' + err.message);
			} else {
				log.verbose(logPrefix + 'genericConsume() - cancel() - Canceled consuming. consumer-tag: "' + returnObj.data['consumer-tag'] + '"');
			}

			cb(err);
		});
		// We could not get this to work :( // Lilleman and gagge 2016-12-27
		//that.handle.once(that.channelName + ':basic.cancel-ok', function(channel, method, data) {
		//	log.verbose(logPrefix + 'consume() - cancel() - Canceled consuming.');
		//	log.debug(logPrefix + 'consume() - cancel() - Canceled consuming. channel: ' + JSON.stringify(channel));
		//	log.debug(logPrefix + 'consume() - cancel() - Canceled consuming. method: ' + JSON.stringify(method));
		//	log.debug(logPrefix + 'consume() - cancel() - Canceled consuming. data: ' + JSON.stringify(data));
		//	cb();
		//});
	};*/

	// Declare exchange
	tasks.push(function(cb) {
		that.declareExchange(options.exchange, cb);
	});

	// Declare queue
	tasks.push(function(cb) {
		if (options.type === 'consume') {
			that.declareQueue({'queueName': queueName}, cb);
		} else if (options.type === 'subscribe') {
			that.declareQueue({'exclusive': true}, function(err, result) {
				queueName = result;
				cb(err);
			});
		} else {
			log.error(logPrefix + 'genericConsume() - Options.type must be "consume" or "subscribe", but is: "' + options.type + '"');
		}
	});

	// Bind queue
	tasks.push(function(cb) {
		that.bindQueue(queueName, options.exchange, cb);
	});

	// Start consuming
	tasks.push(function(cb) {
		const	consumerTag	= null,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#basic.consume.consumer-tag
			noLocal	= false,	// "If the no-local field is set the server will not send messages to the connection
					// that published them." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
			noWait	= false,	// "If set, the server will not respond to the method. The client should not wait
					// for a reply method. If the server could not complete the method it will raise a
					// channel or connection exception." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
			noAck	= false,	// "If this field is set the server does not expect acknowledgements for messages.
					// That is, when a message is delivered to the client the server assumes the delivery
					// will succeed and immediately dequeues it. This functionality may increase performance
					// but at the cost of reliability. Messages can get lost if a client dies before they
					// are delivered to the application." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
			exclusive	= options.exclusive,	// Request exclusive consumer access, meaning only this consumer can access the queue.
			args	= {};	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#basic.consume.arguments

		that.handle.cmd('basic.consume', [that.channelName, queueName, consumerTag, noLocal, noAck, exclusive, noWait, args], function(err, channel, method, data) {
			let	consumerTag;

			if (err) { cb(err); return; }

			returnObj.channel	= channel;
			returnObj.method	= method;
			returnObj.data	= data;

			if (data !== undefined && data['consumer-tag'] !== undefined) {
				consumerTag = data['conumer-tag'];
			} else {
				log.warn(logPrefix + 'genericConsume() - No consumerTag obtained for queue: "' + queueName + '"');
			}

			log.verbose(logPrefix + 'genericConsume() - Started consuming on queue: "' + queueName + '" with consumer tag: "' + consumerTag + '"');
			cb();
		});
	});

	// Register msgCb
	tasks.push(function(cb) {
		const	eventName	= 'incoming_msg_' + options.exchange;

		if (that.listenerCount(eventName) !== 0) {
			const	err	= new Error('Only one subscribe or consume is allowed for each exchange. exchange: "' + options.exchange + '"');
			log.warn(logPrefix + 'genericConsume() - ' + err.message);
			cb(err);
			return;
		}

		that.on(eventName, function(message, deliveryTag) {
			msgCb(message, function(err) {
				if (err) {
					log.warn(logPrefix + 'genericConsume() - nack on deliveryTag: "' + deliveryTag + '" err: ' + err.message);
					that.handle.cmd('basic.nack', [that.channelName, deliveryTag]);
				} else {
					log.debug(logPrefix + 'genericConsume() - ack on deliveryTag: "' + deliveryTag + '"');
					that.handle.cmd('basic.nack', [that.channelName, deliveryTag]);
				}
			}, deliveryTag);
		});

		cb();
	});

	async.series(tasks, function(err) {
		if (err) { cb(err); return; }

		cb(err, returnObj);
	});
};

Intercom.prototype.ready = function(cb) {
	if (this.queueReady === true) {
		cb();
		return;
	}

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
 *		}
 * @param func cb(err, message assigned uuid)
 */
Intercom.prototype.send = function(orgMsg, options, cb) {
	const	message	= require('util')._extend({}, orgMsg),
		that	= this,
		tasks	= [];

	let	cbsRan	= 0,
		cbErr,
		stringifiedMsg;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (cb === undefined) {
		cb = function() {};
	}

	if (options.exchange === undefined) {
		options.exchange	= 'default';
	}

	try {
		if (message.uuid === undefined) {
			message.uuid = uuidLib.v4();
		}

		stringifiedMsg = JSON.stringify(message);
	} catch(err) {
		log.warn(logPrefix + 'send() - Could not stringify message. Message attached to next log call.');
		log.warn(logPrefix + 'send() - Unstringifiable message attached:', message);
		cb(err);
		return;
	}

	log.debug(logPrefix + 'send() - readFromQueue() - Sending to exchange: "' + options.exchange + '", uuid: "' + message.uuid + '", message: "' + stringifiedMsg + '"');

	// Declare exchange
	tasks.push(function(cb) {
		that.declareExchange(options.exchange, cb);
	});

	if (options.forceConsumeQueue === true) {
		const	queueName	= 'queTo_' + options.exchange;

		// Declare queue
		tasks.push(function(cb) {
			that.declareQueue({'queueName': queueName}, cb);
		});

		// Bind queue
		tasks.push(function(cb) {
			that.bindQueue(queueName, options.exchange, cb);
		});
	}

	tasks.push(function(cb) {
		const	properties	= {'content-type': 'application/json'},
			className	= 'basic',
			mandatory	= true,
			immediate	= false;

		that.handle.cmd('basic.publish', [that.channelName, options.exchange, 'ignored-routing-key', mandatory, immediate], function(err) {
			if (err) {
				log.warn(logPrefix + 'send() - readFromQueue() - Could not publish to exchange: "' + options.exchange + '". err: ' + err.message + ', uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');
				if ( ! cbErr) {
					cbErr	= err;
					cb(err);
				}
				return;
			}

			log.debug(logPrefix + 'send() - readFromQueue() - Published (no content sent) to exchange: "' + options.exchange + '", uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');

			cbsRan ++;
			if (cbsRan === 2 && ! cbErr) {
				cb(null);
			}
		});

		that.handle.cmd('content', [that.channelName, className, properties, stringifiedMsg], function(err) {
			if (err) {
				log.warn(logPrefix + 'send() - readFromQueue() - Could not send publish content to exchange: "' + options.exchange + '". err: ' + err.message + ', uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');
				if ( ! cbErr) {
					cbErr	= err;
					cb(err);
				}
				return;
			}

			log.debug(logPrefix + 'send() - readFromQueue() - Content sent to exchange: "' + options.exchange + '", uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');

			cbsRan ++;
			if (cbsRan === 2 && ! cbErr) {
				cb(null);
			}
		});
	});

	async.series(tasks, function(err) {
		cb(err, message.uuid);
	});
};

Intercom.prototype.subscribe = function(options, msgCb, cb) {
	if (typeof options === 'function') {
		cb	= msgCb;
		msgCb	= options;
		options	= {};
	}

	options.type = 'subscribe';

	if (options.exchange === undefined) {
		options.exchange	= 'default';
	}

	log.verbose(logPrefix + 'subscribe() - Starting on exchange "' + options.exchange + '"');

	this.genericConsume(options, msgCb, cb);
};

exports = module.exports = Intercom;
