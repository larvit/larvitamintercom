'use strict';

const	EventEmitter	= require('events').EventEmitter,
	uuidLib	= require('node-uuid'),
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
	that.host	= parsedConStr.hostname;
	that.port	= parsedConStr.port || 5672;
	that.declaredExchanges	= [];
	that.sendQueue	= [];
	that.sendInProgress	= false;

	that.socket = net.connect({
		'port': that.port,
		'host':	that.host
	});

	log.verbose('larvitamintercom: Intercom() - Initializing on ' + that.host + ':' + that.port);

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

	async.series(tasks, function(err) {
		if ( ! err) {
			log.debug('larvitamintercom: Intercom() - Initialized on ' + that.host + ':' + that.port);
			that.emit('ready');
		}
	});
}

// Make Intercom an event emitter
Intercom.prototype.__proto__ = EventEmitter.prototype;

Intercom.prototype.bindQueue = function(queueName, exchangeName, cb) {
	const	noWait	= false,	// "If set, the server will not respond to the method. The client
				// should not wait for a reply method. If the server could not complete
				// the method it will raise a channel or connection exception."
				// - https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.bind.arguments
		that	= this;

	log.verbose('larvitamintercom: bindQueue() - Binding queue "' + queueName + '" to exchange "' + exchangeName + '"');

	that.handle.queue.bind(that.channelName, queueName, exchangeName, 'ignored-routing-key', noWait, args, function(err) {
		if (err) {
			log.error('larvitamintercom: bindQueue() - Could not bind queue: "' + queueName + '" to exchange: "' + exchangeName + '", err: ' + err.message);
		}

		log.debug('larvitamintercom: bindQueue() - Bound queue "' + queueName + '" to exchange "' + exchangeName + '"');

		cb(err);
	});
};

// Close the RabbitMQ connection
Intercom.prototype.close = function(cb) {
	const	that = this;

	log.verbose('larvitamintercom: close() - on ' + that.host + ':' + that.port);

	that.handle.closeAMQPCommunication(function(err) {
		if (err) {
			log.warn('larvitamintercom: close() - Could not closeAMQPCommunication: ' + err.message);
			cb(err);
			return;
		}

		that.handle.socket.end();
		setImmediate(function() {
			log.debug('larvitamintercom: close() - closed ' + that.host + ':' + that.port);
			cb();
		});
	});
};

Intercom.prototype.consume = function(options, msgCb, cb) {
	const	tasks	= [],
		that	= this;

	let	queueName;

	if (typeof options === 'function') {
		cb	= msgCb;
		msgCb	= options;
		options	= {};
	}

	if (cb === undefined) {
		cb = function() {};
	}

	if (options.exchange	=== undefined) {	options.exchange	= 'default';	}

	queueName	= 'queTo_' + options.exchange;

	log.verbose('larvitamintercom: consume() - Starting on exchange "' + options.exchange + '"');

	// Declare exchange
	tasks.push(function(cb) {
		that.declareExchange(options.exchange, cb);
	});

	// Declare queue
	tasks.push(function(cb) {
		that.declareQueue({'queueName': queueName}, cb);
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
			exclusive	= false,	// Request exclusive consumer access, meaning only this consumer can access the queue.
			args	= {};	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#basic.consume.arguments

		that.handle.basic.consume(that.channelName, queueName, consumerTag, noLocal, noAck, exclusive, noWait, args);
		that.handle.once(that.channelName + ':basic.consume-ok', function(channel, method, data) {
			log.verbose('larvitamintercom: consume() - Started consuming with consumer tag: "' + data['consumer-tag'] + '"');
			cb();
		});
	});

	// Register msgCb
	tasks.push(function(cb) {
		that.handle.on(that.channelName + ':basic.deliver', function(channel, method, data) {
			const	deliveryTag	= data['delivery-tag'];

			log.debug('larvitamintercom: consume() - Incoming message, deliveryTag: "' + deliveryTag + '"');

			that.handle.once('content', function(channel, className, properties, content) {
				let	message;

				try {
					message = JSON.parse(content.toString());
				} catch(err) {
					log.warn('larvitamintercom: consume() - Could not parse incoming message. deliveryTag: "' + deliveryTag + '" content: "' + content.toString() + '"');
					cb(err);
					return;
				}

				if (lUtils.formatUuid(message.uuid) === false) {
					log.warn('larvitamintercom: consume() - Message does not contain uuid. deliveryTag: "' + deliveryTag + '" content: "' + content.toString() + '"');
				}

				msgCb(message, function(err) {
					if (err) {
						log.warn('larvitamintercom: consume() - nack on deliveryTag: "' + deliveryTag + '" err: ' + err.message);
						that.handle.basic.nack(that.channelName, deliveryTag);
					} else {
						log.debug('larvitamintercom: consume() - ack on deliveryTag: "' + deliveryTag + '"');
						that.handle.basic.ack(that.channelName, deliveryTag);
					}
				}, deliveryTag);
			});
		});

		cb();
	});

	async.series(tasks, cb);
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

	log.verbose('larvitamintercom: declareExchange() - exchangeName: "' + exchangeName + '"');

	if (that.declaredExchanges.indexOf(exchangeName) !== - 1) {
		log.debug('larvitamintercom: declareExchange() - Exchange already declared! exchangeName: "' + exchangeName + '"');

		cb();
		return;
	}

	that.handle.exchange.declare(
		that.channelName,
		exchangeName,
		exchangeType,
		passive,
		durable,
		autoDelete,
		internal,
		noWait,
		args,
		function(err) {
			if (err) {
				log.warn('larvitamintercom: declareExchange() - Could not declare exchange "' + exchangeName + '", err: ' + err.message);
			}

			log.debug('larvitamintercom: declareExchange() - Declared! exchangeName: "' + exchangeName + '"');

			that.declaredExchanges.push(exchangeName);
			cb(err);
		}
	);

	/* Alternate method
	that.handle.once('1:exchange.declare-ok', function(channel, method, data) {
		console.log('exchange declared');
		console.log(channel);
		console.log(method);
		console.log(data);
		cb();
	});*/
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
		durable	= true,	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.durable
		noWait	= false,	//  "If set, the server will not respond to the method. The client should not
				// wait for a reply method. If the server could not complete the method it will
				// raise a channel or connection exception." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.declare.arguments
		that	= this;

	if ( ! options.queueName)	{ options.queueName	= '';	}
	if (options.exclusive === undefined)	{ options.exclusive	= false;	}

	log.verbose('larvitamintercom: declareQueue() - Declaring. queueName: "' + options.queueName + '" exclusive: ' + options.exclusive.toString());

	that.handle.queue.declare(that.channelName, options.queueName, passive, durable, options.exclusive, autoDelete, noWait, args, function(err) {
		if (err) {
			log.error('larvitamintercom: declareQueue() - Could not declare queue, name: "' + options.queueName + '" err: ' + err.message);
		}

		that.handle.once(that.channelName + ':queue.declare-ok', function(channel, method, data) {
			const queueName = data.queue;
			log.debug('larvitamintercom: declareQueue() - Declared! queueName: "' + queueName + '" exclusive: ' + options.exclusive.toString());
			cb(err, queueName);
		});
	});
};

/**
 * Send something
 *
 * @param obj message - message will be appended with an uuid if that does not exist
 * @param obj options - OPTIONAL - options.exchange = str
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

	if (options.exchange	=== undefined) {	options.exchange	= 'default';	}

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

		log.debug('larvitamintercom: send() - readFromQueue() - Sending to exchange: "' + options.exchange + '", uuid: "' + message.uuid + ', message: "' + stringifiedMsg + '"');

		// Declare exchange
		tasks.push(function(cb) {
			that.declareExchange(options.exchange, cb);
		});

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
	const	tasks	= [],
		that	= this;

	let	queueName;

	if (typeof options === 'function') {
		cb	= msgCb;
		msgCb	= options;
		options	= {};
	}

	if (cb === undefined) {
		cb = function() {};
	}

	if (options.exchange	=== undefined) {	options.exchange	= 'default';	}

	log.verbose('larvitamintercom: consume() - Starting on exchange "' + options.exchange + '"');

	// Declare exchange
	tasks.push(function(cb) {
		that.declareExchange(options.exchange, cb);
	});

	// Declare queue
	tasks.push(function(cb) {
		that.declareQueue({'exclusive': true}, function(err, result) {
			if (err) throw err;

			queueName = result;
			cb();
		});
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
			exclusive	= false,	// Request exclusive consumer access, meaning only this consumer can access the queue.
			args	= {};	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#basic.consume.arguments

		that.handle.basic.consume(that.channelName, queueName, consumerTag, noLocal, noAck, exclusive, noWait, args);
		that.handle.once(that.channelName + ':basic.consume-ok', function(channel, method, data) {
			log.verbose('larvitamintercom: subscribe() - Started consuming with consumer tag: "' + data['consumer-tag'] + '"');
			cb();
		});
	});

	// Register msgCb
	tasks.push(function(cb) {
		that.handle.on(that.channelName + ':basic.deliver', function(channel, method, data) {
			const	deliveryTag	= data['delivery-tag'];

			log.debug('larvitamintercom: subscribe() - Incoming message, deliveryTag: "' + deliveryTag + '"');

			that.handle.once('content', function(channel, className, properties, content) {
				let	message;

				try {
					message = JSON.parse(content.toString());
				} catch(err) {
					log.warn('larvitamintercom: subscribe() - Could not parse incoming message. deliveryTag: "' + deliveryTag + '" content: "' + content.toString() + '"');
					cb(err);
					return;
				}

				if (lUtils.formatUuid(message.uuid) === false) {
					log.warn('larvitamintercom: consume() - Message does not contain uuid. deliveryTag: "' + deliveryTag + '" content: "' + content.toString() + '"');
				}

				msgCb(message, function(err) {
					if (err) {
						log.warn('larvitamintercom: subscribe() - nack on deliveryTag: "' + deliveryTag + '" err: ' + err.message);
						that.handle.basic.nack(that.channelName, deliveryTag);
					} else {
						log.debug('larvitamintercom: subscribe() - ack on deliveryTag: "' + deliveryTag + '"');
						that.handle.basic.ack(that.channelName, deliveryTag);
					}
				}, deliveryTag);
			});
		});

		cb();
	});

	async.series(tasks, cb);
};

exports = module.exports = Intercom;
