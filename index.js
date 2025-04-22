'use strict';

const	EventEmitter	= require('events').EventEmitter,
	topLogPrefix	= 'larvitamintercom: index.js: ',
	{ 'v4': uuidLib }	= require('uuid'),
	amqp = require('amqp-connection-manager'),
	{ Log, Utils }	= require('larvitutils'),
	lUtils	= new Utils(),
	async	= require('async');

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
 * @param str[] options - AMQP connection strings in an array
 * or
 * @param obj options - {'conStr': 'see above', 'log': instance of log object}
 */
function Intercom(options) {
	const that	= this;

	let	logPrefix	= topLogPrefix + 'Intercom() - ';

	if (typeof options === 'string' || Array.isArray(options)) {
		options	= {'conStr': options};
	}

	if ( ! options.log) {
		options.log	= new Log();
	}

	that.options	= options;
	that.log	= that.options.log;
	that.channelName	= 1;
	that.cmdQueue	= [];
	that.conStr	= options.conStr;
	that.declaredExchanges	= [];
	that.expectingClose	= false;
	that.queueReady	= false;
	that.uuid	= uuidLib();
	that.boundQueues	= []; // list of queues that is bound so to limit network talk
	that.declaredQueues	= []; // list of queues that is declared to limit network talk

	logPrefix += 'uuid: ' + that.uuid + ' - ';

	if (that.options.conStr === 'loopback interface') {
		that.loopback	= true;
		that.loopbackConQueue	= {};
		that.handle	= new EventEmitter;
		that.handle.channel = {};
		that.handle.channel.ack = () => {};
		that.handle.channel.nack = () => {};

		that.log.verbose(logPrefix + 'Initializing on loopback interface');

		that.initializeListeners();
	} else {
		that.loopback	= false;
		if (typeof that.options.conStr === 'string') {
			that.servers = [that.options.conStr];
		} else {
			that.servers = that.options.conStr;
		}

		that.handle = amqp.connect(that.servers);

		that.handle.on('connect', function (options) {
			that.log.info(logPrefix + 'AMQP connected to "' + options.url + '"');

			that.handle.channel = that.handle.createChannel({
				'json': true,
				'setup': newChannel => {
					that.channel = newChannel;
				}
			});

			that.handle.channel.on('connect', function () {
				that.log.verbose(logPrefix + 'Channel connected.');
				that.initializeListeners();
			});

			that.handle.channel.on('error', function (err) {
				that.log.error(logPrefix + 'Channel error: "' + err + '"');
			});
		});

		that.handle.on('connectFailed', function (options) {
			that.log.error(logPrefix + 'AMQP failed to connect to "' + options.url + '" with error: "' + options.err + '"');
		});

		that.handle.on('disconnect', function (options) {
			that.log.error(logPrefix + 'AMQP disconnected with error: "' + options.err + '"');
		});

		that.handle.on('blocked', function (options) {
			that.log.warn(logPrefix + 'AMQP connection is blocked with reason: "' + options.reason + '"');
		});

		that.handle.on('unblocked', function () {
			that.log.info(logPrefix + 'AMQP is unblocked.');
		});
	}
}

Intercom.prototype.initializeListeners = function () {
	const tasks = [],
		that = this,
		logPrefix = topLogPrefix + 'initializeListeners() - ';

	// Set QoS to 10
	tasks.push(function (cb) {
		if (that.loopback === true) return cb();

		const	prefetchCount	= 10,
			global	= true;

		that.channel.prefetch(prefetchCount, global).then(() => {
			that.log.verbose(logPrefix + 'basic.qos set to: "' + prefetchCount + '"');

			cb();
		}).catch(err => {
			cb(err);
		});
	});

	async.series(tasks, function (err) {
		if ( ! err) {
			if (that.loopback === true) {
				that.log.verbose(logPrefix + 'Initialized on loopback interface');
			} else {
				that.log.verbose(logPrefix + 'Initialized on ' + that.servers.join(', '));
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
		args	= {},	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#queue.bind.arguments
		that	= this;

	if (that.boundQueues[queueName + '___' + exchange] === true) return cb();

	that.log.debug(logPrefix + 'Binding queue "' + queueName + '" to exchange "' + exchange + '"');

	if (that.loopback === true) return cb();

	that.ready(function (err) {
		if (err) return cb(err);

		that.handle.channel.bindQueue(queueName, exchange, '', args).then(() => {
			that.boundQueues[queueName + '___' + exchange]	= true;
			// log.silly(logPrefix + 'Bound queue "' + queueName + '" to exchange "' + exchange + '"');

			cb();
		}).catch(err => {
			that.log.error(logPrefix + 'Could not bind queue: "' + queueName + '" to exchange: "' + exchange + '", err: ' + err.message);
			cb(err);
		});
	});
};

// Close the RabbitMQ connection
// Intercom.prototype.close = function (cb) {
// 	const	logPrefix	= topLogPrefix + 'close() - conUuid: ' + this.uuid + ' - ',
// 		that	= this;

// 	if (typeof cb !== 'function') {
// 		cb = function () {};
// 	}

// 	if (that.loopback === true) {
// 		that.log.verbose(logPrefix + 'on loopback interface');
// 		return cb();
// 	} else {
// 		that.log.verbose(logPrefix + 'on ' + that.host + ':' + that.port);
// 	}

// 	that.expectingClose	= true;

// 	that.ready(function (err) {
// 		if (err) return cb(err);

// 		that.handle.close();

// 		setImmediate(function () {
// 			that.log.verbose(logPrefix + 'closed ' + that.host + ':' + that.port);

// 			cb();
// 		});
// 	});
// };

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
		durable	= true,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#exchange.declare.durable
		that	= this;

	if (that.loopback === true) return cb();

	that.ready(function (err) {
		if (err) return cb(err);

		if (that.declaredExchanges.indexOf(exchangeName) !== - 1) {
			// log.silly(logPrefix + 'Already declared.');
			return cb();
		}

		that.log.debug(logPrefix + 'Declaring');

		that.handle.channel.assertExchange(exchangeName, exchangeType, { durable, internal, autoDelete }).then(() => {
			that.declaredExchanges.push(exchangeName);
			cb();
		}).catch(err => {
			that.log.warn(logPrefix + 'Could not declare exchange, err: ' + err.message);
			return cb(err);
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

		that.handle.channel.assertQueue(options.queueName, { durable, autoDelete }).then(data => {
			if (options.queueName !== '') {
				that.declaredQueues[queueKey]	= true;
			}
			cb(err, data.queue);
		}).catch(err => {
			that.log.error(logPrefix + 'Could not declare queue, err: ' + err.message);
			return cb(err);
		});
	});
};

// Intercom.prototype.deleteQueue = function (queueName, cb) {
// 	const	ifUnused	= false,	// If set, the server will only delete the queue if it
// 		// has no consumers. If the queue has consumers the
// 		// server does does not delete it but raises a channel
// 		// exception instead.
// 		ifEmpty	= false,	// If set, the server will only delete the queue if it
// 		// has no messages.
// 		logPrefix	= topLogPrefix + 'Intercom.prototype.deleteQueue() - conUuid: ' + this.uuid + ' - ';

// 	if (typeof cb !== 'function') {
// 		cb = function () {};
// 	}

// 	that.handle.channel.deleteQueue(queueName, { ifUnused, ifEmpty }, function (err, data) {
// 		if (err) {
// 			that.log.error(logPrefix + 'Could not delete queue, err: ' + err.message);

// 			return cb(err);
// 		}

// 		that.log.verobse(topLogPrefix + 'deleteQueue() - queue "' + queueName + '", containing "' + data.messageCount + '" deleted.');

// 		cb();
// 	});
// };

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
					that.log.warn(logPrefix + 'nack, err: ' + err.message);

					that.handle.channel.nack(message);
				} else {
					const msg = Object.assign(message, {
						'fields': {
							deliveryTag
						}
					});

					// log.silly(logPrefix + 'ack');

					that.handle.channel.ack(msg);

				}
			}, deliveryTag);
		});

		cb();
	});

	// Start consuming
	tasks.push(function (cb) {
		const	consumerTag	= null,	//	https://www.rabbitmq.com/amqp-0-9-1-reference.html#basic.consume.consumer-tag
			noLocal	= false,	//	"If the no-local field is set the server will not send messages to the connection
			//			that published them." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
			noAck	= false,	//	"If this field is set the server does not expect acknowledgements for messages.
			//			That is, when a message is delivered to the client the server assumes the delivery
			//			will succeed and immediately dequeues it. This functionality may increase performance
			//			but at the cost of reliability. Messages can get lost if a client dies before they
			//			are delivered to the application." - https://www.rabbitmq.com/amqp-0-9-1-reference.html
			exclusive	= options.exclusive;	//	Request exclusive consumer access, meaning only this consumer can access the queue.

		// No need to send a command on the queue for the loopback, handle this directly in the send function
		if (that.loopback === true) return cb();

		that.handle.channel.consume(queueName, function (message) {
			let content;

			try {
				content = JSON.parse(message.content.toString());
			} catch (err) {
				that.log.warn(logPrefix + 'subscribe() - Could not parse incoming message. exchange: "' + options.exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + message.fields.deliveryTag + '", content: "' + message.content.toString() + '"');

				return;
			}

			if (lUtils.formatUuid(content.uuid) === false) {
				that.log.warn(logPrefix + 'consume() - Message does not contain uuid. exchange: "' + options.exchange + '", consumerTag: "' + consumerTag + '", deliveryTag: "' + message.fields.deliveryTag + '", content: "' + content.toString() + '"');
			}

			that.emit('incoming_msg_' + options.exchange, content, message.fields.deliveryTag);
		}, { consumerTag, noLocal, noAck, exclusive }).then(data => {
			let	consumerTag;

			returnObj.data = data;

			if (data !== undefined && data.consumerTag !== undefined) {
				consumerTag = data.consumerTag;
			} else {
				that.log.warn(logPrefix + 'No consumerTag obtained for queue: "' + queueName + '"');
			}

			that.log.verbose(logPrefix + 'Started consuming on queue: "' + queueName + '" with consumer tag: "' + consumerTag + '"');
			cb();
		}).catch(err => {
			return cb(err);
		});
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
		message	= Object.assign({}, orgMsg),
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
		message.uuid = uuidLib();
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

		that.emit('incoming_msg_' + options.exchange, message, uuidLib());

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
		const	mandatory	= true,
			immediate	= false;

		that.handle.channel.publish(options.exchange, 'ignored-routing-key', message, { mandatory, immediate }).then(() => {
			// log.silly(logPrefix + 'Published (no content sent) to exchange: "' + options.exchange + '", uuid: "' + message.uuid + '", message: "' + stringifiedMsg + '"');

			cbsRan ++;
			if (cbsRan === 2 && ! cbErr) {
				cb(null);
			}

			cb();
		}).catch(err => {
			that.log.warn(logPrefix + 'Could not publish to exchange: "' + options.exchange + '". err: "' + err.message + '", uuid: "' + message.uuid + '", message: "' + stringifiedMsg + '"');

			if ( ! cbErr) {
				cbErr	= err;
				cb(err);
			}

			return;
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
