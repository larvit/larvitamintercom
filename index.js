'use strict';

const	EventEmitter	= require('events').EventEmitter,
	bramqp	= require('bramqp'),
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

	that.socket = net.connect({
		'port': parsedConStr.port || 5672,
		'host':	parsedConStr.hostname
	});

	// Create handle by socket connect to rabbitmq
	tasks.push(function(cb) {
		bramqp.initialize(that.socket, 'rabbitmq/full/amqp0-9-1.stripped.extended', function(err, result) {
			if (err) {
				log.error('larvitamintercom: Intercom() - Error connecting to RabbitMQ: ' + err.message);
				that.emit('error', err);
			}

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

	that.handle.queue.bind(that.channelName, queueName, exchangeName, 'ignored-routing-key', noWait, args, function(err) {
		if (err) {
			log.error('larvitamintercom: bindQueue() - Could not bind queue: "' + queueName + '" to exchange: "' + exchangeName + '", err: ' + err.message);
		}

		cb(err);
	});
};

// Close the RabbitMQ connection
Intercom.prototype.close = function(cb) {
	const	that = this;

	that.handle.closeAMQPCommunication(function(err) {
		if (err) {
			log.warn('larvitamintercom: close() - Could not closeAMQPCommunication: ' + err.message);
			cb(err);
			return;
		}

		that.handle.socket.end();
		setImmediate(cb);
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
			console.log('Consuming from queue');

			console.log('channel:');
			console.log(channel);

			console.log('method:');
			console.log(method);

			console.log('data:');
			console.log(data);

			cb();
		});
	});

	// Register msbCb
	tasks.push(function(cb) {
		that.handle.on(that.channelName + ':basic.deliver', function(channel, method, data) {
			console.log('incomming message, data:');
			console.log(data);

			that.handle.once('content', function(channel, className, properties, content) {
				console.log('got a message:');
				console.log(content.toString());
				console.log('with properties:');
				console.log(properties);
				console.log('channel:');
				console.log(channel);
				console.log('className:');
				console.log(className);

				that.handle.basic.ack(1, data['delivery-tag']);

				//that.handle.basic.ack()
				msgCb(content);
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
		noWait	= false,	// "If set, the server will not respond to the method. The client should not wait for a reply method. If the server could not complete the method it will raise a channel or connection exception." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
		args	= {},	// https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.arguments
		that	= this;



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

	if (options.queueName	=== undefined)	{ options.queueName	= null;	}
	if (options.exclusive	=== undefined)	{ options.exclusive	= false;	}

	that.handle.queue.declare(that.channelName, options.queueName, passive, durable, options.exclusive, autoDelete, noWait, args, function(err) {
		if (err) {
			log.error('larvitamintercom: declareQueue() - Could not declare queue, name: "' + options.queueName + '" err: ' + err.message);
		}

		cb(err);
	});

	/* Alternate cb method
	that.handle.once('1:queue.declare-ok', function(channel, method, data) {
		console.log('queue declared');
		queueName = data.queue;
		seriesCallback();
	});*/
};

Intercom.prototype.send = function(message, options, cb) {
	const	tasks	= [],
		that	= this;

	let	stringifiedMsg,
		queueName;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (cb === undefined) {
		cb = function() {};
	}

	if (options.exchange	=== undefined) {	options.exchange	= 'default';	}

	queueName	= 'queTo_' + options.exchange;

	try {
		stringifiedMsg = JSON.stringify(message);
	} catch(err) {
		log.warn('larvitamintercom: send() - Could not stringify message. Message attached to next log call.');
		log.warn('larvitamintercom: send() - Unstringifiable message attached:', message);
		cb(err);
		return;
	}

	log.verbose('larvitamintercom: send() - Sending to exchange: "' + options.exchange + '", message: "' + stringifiedMsg + '"');

	// Declare exchange
	tasks.push(function(cb) {
		that.declareExchange(options.exchange, cb);
	});

	// Declare persistent work queue for consumers
	tasks.push(function(cb) {
		that.declareQueue({'queueName': queueName}, cb);
	});

	// Bind work queue
	tasks.push(function(cb) {
		that.bindQueue(queueName, options.exchange, cb);
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
					log.warn('larvitamintercom: send() - Could not publish to exchange: "' + options.exchange + '". err: ' + err.message + ' message: "' + stringifiedMsg + '"');
					cb(err);
					return;
				}

				log.debug('larvitamintercom: send() - Published (no content sent) to exchange: "' + options.exchange + '", message: "' + stringifiedMsg + '"');

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
				log.warn('larvitamintercom: send() - Could not send publish content to exchange: "' + options.exchange + '". err: ' + err.message + ' message: "' + stringifiedMsg + '"');
			}

			log.debug('larvitamintercom: send() - Content sent to exchange: "' + options.exchange + '", message: "' + stringifiedMsg + '"');

			cb(err);
		});
	});

	async.series(tasks, cb);
};

exports = module.exports = Intercom;
