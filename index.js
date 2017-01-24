'use strict';

const	EventEmitter	= require('events').EventEmitter,
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
 */
function Intercom(conStr) {
	const	parsedConStr	= url.parse(conStr),
		tasks	= [],
		that	= this;

	that.channelName	= 1;
	that.cmdQueue	= [];
	that.conStr	= conStr;
	that.declaredExchanges	= [];
	that.host	= parsedConStr.hostname;
	that.port	= parsedConStr.port || 5672;
	that.queueReady	= false;
	that.sendInProgress	= false;
	that.sendQueue	= [];

	that.socket = net.connect({
		'port': that.port,
		'host':	that.host
	});

	log.verbose('larvitamintercom: Intercom() - Initializing on ' + that.host + ':' + that.port);

	that.socket.on('error', function(err) {
		log.error('larvitamintercom: Intercom() - socket error: ' + err.message);
	});

	that.socket.on('close', function(hadError) {
		log.info('larvitamintercom: Intercom() - socket closed');
		if (hadError) {
			log.error('larvitamintercom: Intercom() - socket closed with error');
		}
	});

	that.socket.on('end', function() {
		log.info('larvitamintercom: Intercom() - socket connection ended by remote');
	});

	// Create handle by socket connect to rabbitmq
	tasks.push(function(cb) {
		bramqp.initialize(that.socket, 'rabbitmq/full/amqp0-9-1.stripped.extended', function(err, result) {
			if (err) {
				log.error('larvitamintercom: Intercom() - Error connecting to ' + that.host + ':' + that.port + ' err: ' + err.message);
				that.emit('error', err);
			}

			log.debug('larvitamintercom: Intercom() - bramqp.initialize() ran on ' + that.host + ':' + that.port);

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

		log.debug('larvitamintercom: Intercom() - openAMQPCommunication running on ' + that.host + ':' + that.port + ' with username: ' + username);

		that.handle.openAMQPCommunication(username, password, heartBeat, function(err) {
			if (err) {
				log.error('larvitamintercom: Intercom() - Error opening AMQP communication: ' + err.message);
				that.emit('error', err);
			}

			cb(err);
		});
	});

	// Register listener for incoming messages
	tasks.push(function(cb) {
		that.handle.on(that.channelName + ':basic.deliver', function(channel, method, data) {
			const	exchange	= data.exchange,
				deliveryTag	= data['delivery-tag'],
				consumerTag	= data['consumer-tag'];

			log.debug('larvitamintercom: Intercom() - Incoming message. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '"');

			that.handle.once('content', function(channel, className, properties, content) {
				let	message;

				log.debug('larvitamintercom: Intercom() - Incoming message content. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');

				try {
					message = JSON.parse(content.toString());
				} catch(err) {
					log.warn('larvitamintercom: subscribe() - Could not parse incoming message. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');
					cb(err);
					return;
				}

				if (lUtils.formatUuid(message.uuid) === false) {
					log.warn('larvitamintercom: consume() - Message does not contain uuid. exchange: "' + exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + deliveryTag + '", content: "' + content.toString() + '"');
				}

				that.emit('incoming_msg_' + exchange, message, deliveryTag);
			});
		});
		cb();
	});

	// Log all handle events
	// Should be disabled in production code and only manually enabled while debugging due to it being expensive
	/** /tasks.push(function(cb) {
		const	oldEmitter	= that.handle.emit;

		that.handle.emit = function() {
			const	emitArgs	= arguments;

			log.silly('larvitamintercom: handle.on("' + arguments[0] + '"), all arguments: "' + JSON.stringify(arguments) + '"');

			oldEmitter.apply(that.handle, arguments);
		}

		cb();
	});/**/

	// Construct generic handle comms
	tasks.push(function(cb) {
		that.handle.cmd = function cmd(cmdStr, params, cb) {
			that.cmdQueue.push({'cmdStr': cmdStr, 'params': params, 'cb': cb});

			log.debug('larvitamintercom: handle.cmd() - cmdStr: "' + cmdStr + '" added to run queue. params: "' + JSON.stringify(params) + '"');

			if (that.cmdInProgress === true) {
				log.silly('larvitamintercom: handle.cmd() - cmdStr: "' + cmdStr + '" cmdInProgress === true');
				return;
			}

			log.silly('larvitamintercom: handle.cmd() - cmdStr: "' + cmdStr + '" cmdInProgress !== true');

			that.cmdInProgress = true;

			function readFromQueue() {
				const	mainParams	= that.cmdQueue.shift(),
					cmdStr	= mainParams.cmdStr,
					params	= mainParams.params,
					cb	= mainParams.cb,
					tasks	= [];

				let	channel,
					method,
					data;

				// Register the callback
				tasks.push(function(cb) {
					const	cmdGroupName	= cmdStr.split('.')[0],
						cmdName	= cmdStr.split('.')[1];

					let	callCb	= true,
						okTimeout;

					okTimeout = setTimeout(function() {
						const	err	= new Error('no answer received from queue within 500ms');
						log.error('larvitamintercom: handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", ' + err.message);
						callCb = false;
						cb(err);
					}, 500);

					that.handle.once(that.channelName + ':' + cmdStr + '-ok', function(x, y, z) {
						// We want these in the outer scope, thats why the weird naming
						channel	= x;
						method	= y;
						data	= z;

						log.debug('larvitamintercom: handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", answer received from queue');
						if (callCb === false) {
							log.warn('larvitamintercom: handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '", answer received but to late; timeout have already happened');
							return;
						}
						clearTimeout(okTimeout);
						cb();
					});

					params.push(function(err) {
						if (err) {
							log.error('larvitamintercom: handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" failed, err: ' + err.message);
							callCb = false;
							cb(err);
							return;
						}

						log.debug('larvitamintercom: handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" succeeded');
					});
					that.handle[cmdGroupName][cmdName].apply(null, params);
				});

				async.series(tasks, function(err) {
					cb(err, channel, method, data);

					if (that.cmdQueue.length === 0) {
						log.silly('larvitamintercom: handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" cmdQueue.length === 0');
						that.cmdInProgress = false;
					} else {
						log.silly('larvitamintercom: handle.cmd() - readFromQueue() - cmdStr: "' + cmdStr + '" readFromQueue() rerunning');
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
			log.debug('larvitamintercom: Intercom() - Initialized on ' + that.host + ':' + that.port);
			that.queueReady	= true;
			that.emit('ready');
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

	log.verbose('larvitamintercom: bindQueue() - Binding queue "' + queueName + '" to exchange "' + exchange + '"');

	that.ready(function(err) {
		if (err) { cb(err); return; }

		that.handle.cmd('queue.bind', [that.channelName, queueName, exchange, 'ignored-routing-key', noWait, args], function(err) {
			if (err) {
				log.error('larvitamintercom: bindQueue() - Could not bind queue: "' + queueName + '" to exchange: "' + exchange + '", err: ' + err.message);
			}

			log.debug('larvitamintercom: bindQueue() - Bound queue "' + queueName + '" to exchange "' + exchange + '"');

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

	log.verbose('larvitamintercom: close() - on ' + that.host + ':' + that.port);

	that.ready(function(err) {
		if (err) { cb(err); return; }

		that.handle.closeAMQPCommunication(function(err) {
			if (err) {
				log.warn('larvitamintercom: close() - Could not closeAMQPCommunication: ' + err.message);
				cb(err);
				return;
			}

			setImmediate(function() {
				log.debug('larvitamintercom: close() - closed ' + that.host + ':' + that.port);
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

	log.verbose('larvitamintercom: consume() - Starting on exchange "' + options.exchange + '"');

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

	log.debug('larvitamintercom: declareExchange() - exchangeName: "' + exchangeName + '"');

	that.ready(function(err) {
		if (err) { cb(err); return; }

		if (that.declaredExchanges.indexOf(exchangeName) !== - 1) {
			log.debug('larvitamintercom: declareExchange() - Already declared. exchangeName: "' + exchangeName + '"');
			cb();
			return;
		}

		log.verbose('larvitamintercom: declareExchange() - Declaring exchangeName: "' + exchangeName + '"');

		that.handle.cmd('exchange.declare', [that.channelName, exchangeName, exchangeType, passive, durable, autoDelete, internal, noWait, args], function(err) {
			if (err) {
				log.warn('larvitamintercom: declareExchange() - Could not declare exchange "' + exchangeName + '", err: ' + err.message);
				cb(err);
				return;
			}

			log.debug('larvitamintercom: declareExchange() - Declared! exchangeName: "' + exchangeName + '"');

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

	log.verbose('larvitamintercom: declareQueue() - Declaring queueName: "' + options.queueName + '" exclusive: ' + options.exclusive.toString());

	that.ready(function(err) {
		if (err) { cb(err); return; }

		that.handle.cmd('queue.declare', [that.channelName, options.queueName, passive, durable, options.exclusive, autoDelete, noWait, args], function(err, channel, method, data) {
			let queueName;

			if (err) {
				log.error('larvitamintercom: declareQueue() - Could not declare queue, name: "' + options.queueName + '" err: ' + err.message);
				cb(err);
				return;
			}

			queueName = data.queue;
			log.debug('larvitamintercom: declareQueue() - Declared! queueName: "' + queueName + '" exclusive: ' + options.exclusive.toString());
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
		log.verobse('larvitamintercom: deleteQueue() - queue "' + queueName + '", containing "' + data['message-count'] + '" deleted.');
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
			log.warn('larvitamintercom: genericConsume() - cancel() - ' + err.message);
			cb(err);
			return;
		}

		that.handle.basic.cancel(returnObj.data['consumer-tag'], function(err) {
			if (err) {
				log.warn('larvitamintercom: genericConsume() - cancel() - Could not canceled consuming. consumer-tag: "' + returnObj.data['consumer-tag'] + '", err: ' + err.message);
			} else {
				log.verbose('larvitamintercom: genericConsume() - cancel() - Canceled consuming. consumer-tag: "' + returnObj.data['consumer-tag'] + '"');
			}

			cb(err);
		});
		// We could not get this to work :( // Lilleman and gagge 2016-12-27
		//that.handle.once(that.channelName + ':basic.cancel-ok', function(channel, method, data) {
		//	log.verbose('larvitamintercom: consume() - cancel() - Canceled consuming.');
		//	log.debug('larvitamintercom: consume() - cancel() - Canceled consuming. channel: ' + JSON.stringify(channel));
		//	log.debug('larvitamintercom: consume() - cancel() - Canceled consuming. method: ' + JSON.stringify(method));
		//	log.debug('larvitamintercom: consume() - cancel() - Canceled consuming. data: ' + JSON.stringify(data));
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
			log.error('larvitamintercom: genericConsume() - Options.type must be "consume" or "subscribe", but is: "' + options.type + '"');
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
				log.warn('larvitamintercom: genericConsume() - No consumerTag obtained for queue: "' + queueName + '"');
			}

			log.verbose('larvitamintercom: genericConsume() - Started consuming on queue: "' + queueName + '" with consumer tag: "' + consumerTag + '"');
			cb();
		});
	});

	// Register msgCb
	tasks.push(function(cb) {
		const	eventName	= 'incoming_msg_' + options.exchange;

		if (that.listenerCount(eventName) !== 0) {
			const	err	= new Error('Only one subscribe or consume is allowed for each exchange. exchange: "' + options.exchange + '"');
			log.warn('larvitamintercom: genericConsume() - ' + err.message);
			cb(err);
			return;
		}

		that.on(eventName, function(message, deliveryTag) {
			msgCb(message, function(err) {
				if (err) {
					log.warn('larvitamintercom: genericConsume() - nack on deliveryTag: "' + deliveryTag + '" err: ' + err.message);
					that.handle.basic.nack(that.channelName, deliveryTag);
				} else {
					log.debug('larvitamintercom: genericConsume() - ack on deliveryTag: "' + deliveryTag + '"');
					that.handle.basic.ack(that.channelName, deliveryTag);
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
	const	that	= this;

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

	that.sendQueue.push({'orgMsg': orgMsg, 'options': options, 'cb': cb});

	if (that.sendInProgress === true) {
		return;
	}

	that.sendInProgress = true;

	function readFromQueue() {
		const	params	= that.sendQueue.shift(),
			orgMsg	= params.orgMsg,
			options	= params.options,
			cb	= params.cb,
			message	= require('util')._extend({}, orgMsg),
			tasks	= [];

		let	stringifiedMsg;

		try {
			if (message.uuid === undefined) {
				message.uuid = uuidLib.v4();
			}

			stringifiedMsg = JSON.stringify(message);
		} catch(err) {
			log.warn('larvitamintercom: send() - Could not stringify message. Message attached to next log call.');
			log.warn('larvitamintercom: send() - Unstringifiable message attached:', message);
			cb(err);
			return;
		}

		log.debug('larvitamintercom: send() - readFromQueue() - Sending to exchange: "' + options.exchange + '", uuid: "' + message.uuid + '", message: "' + stringifiedMsg + '"');

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

		// Publish
		tasks.push(function(cb) {
			const	mandatory	= true,
				immediate	= false;

			that.handle.basic.publish(
				that.channelName,
				options.exchange,
				'ignored-routing-key',
				mandatory,
				immediate,
				function(err) {
					if (err) {
						log.warn('larvitamintercom: send() - readFromQueue() - Could not publish to exchange: "' + options.exchange + '". err: ' + err.message + ', uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');
						cb(err);
						return;
					}

					log.debug('larvitamintercom: send() - readFromQueue() - Published (no content sent) to exchange: "' + options.exchange + '", uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');

					cb();
				}
			);
		});

		// Send content
		tasks.push(function(cb) {
			const	properties	= {'content-type': 'application/json'},
				className	= 'basic';

			that.handle.content(that.channelName, className, properties, stringifiedMsg, function(err) {
				if (err) {
					log.warn('larvitamintercom: send() - readFromQueue() - Could not send publish content to exchange: "' + options.exchange + '". err: ' + err.message + ', uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');
				}

				log.debug('larvitamintercom: send() - readFromQueue() - Content sent to exchange: "' + options.exchange + '", uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');

				cb(err);
			});
		});

		async.series(tasks, function(err) {
			cb(err, message.uuid);

			if (that.sendQueue.length === 0) {
				that.sendInProgress = false;
			} else {
				readFromQueue();
			}
		});
	}
	readFromQueue();
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

	log.verbose('larvitamintercom: subscribe() - Starting on exchange "' + options.exchange + '"');

	this.genericConsume(options, msgCb, cb);
};

exports = module.exports = Intercom;
