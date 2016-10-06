'use strict';

const	log	= require('winston'),
	amqp	= require('amqplib/callback_api'),
	events	= require('events');

function Intercom(url) {
	const that = this;

	this.connected	= false;
	this.eventEmitter	= new events.EventEmitter();

	amqp.connect(url, function(err, connection) {
		if (err) {
			log.error('larvitamintercom: Connection error: ' + err.message);
			return;
		}

		that.connection	= connection;
		that.connected	= true;
		that.eventEmitter.emit('connected');
	});
};

/*
 * Send message to queue
 *
 * @param obj	msg	- object that will be sent as message. Must be serializable
 * @param obj	options	- object, optional
 * @param func	cb	- function(err) - will be invoked when the message is acked
 */
Intercom.prototype.send = function(msg, options, cb) {
	const	that	= this;

	let	serializedMsg;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (cb === undefined) {
		cb	= function() {};
	}

	if (options === undefined) {
		options = {};
	}

	if (options.que	=== undefined)	options.que	= '';
	if (options.durable	=== undefined)	options.durable	= false;
	if (options.publish	=== undefined)	options.publish	= true;
	if (options.exchange	=== undefined)	options.exchange	= options.que;

	try {
		serializedMsg	= JSON.serialize(msg);
		serializedMsg	= new Buffer(serializedMsg);
	} catch(err) {
		log.warn('larvitamintercom: send() - Could not serialize msg. Msg follows in next log entry');
		log.warn('larvitamintercom: send() - Unserializable msg:', msg);
		cb(err);
		return;
	}

	this.ready(function() {
		that.connection.createChannel(function(err, channel) {
			if (err) {
				log.error('larvitamintercom: send(): Channel error: ' + err.message);
				cb(err);
				return;
			}

			channel.assertQueue(options.que);
			log.verbose('larvitamintercom: Sending message on que \'' + options.que + '\': ' + msg);
			channel.sendToQueue(options.que, serializedMsg);

			if (options.publish === true) {
				that.publish(serializedMsg, {'exchange': options.exchange, 'msgSerialized': true}, cb);
			} else {
				cb();
			}
		});
	});
};

// Consume messages directly from que;
Intercom.prototype.consume = function(options, msgCb, cb) {
	const	that	= this;

	this.ready(function() {
		if (options.que	=== undefined)	options.que	= '';
		if (options.ack	=== undefined)	options.ack	= true;
		if (cb	=== undefined)	cb	= function() {};

		that.connection.createChannel(function(err, channel) {
			if (err) {
				log.error('larvitamintercom: consume() - Channel error: ' + err.message);
				cb(err);
				return;
			}

			channel.assertQueue(options.que);
			log.verbose('larvitamintercom: consume() - Consuming messages on que: \'' + options.que + '\'');
			channel.consume(options.que, function(rawMsg) {
				let msg;

				try {
					msg	= JSON.parse(rawMsg.content.toString());
				} catch(err) {
					log.warn('larvitamintercom: consume() - Unparseable message: ' + rawMsg.content.toString());
					msg = false;
				}

				msgCb(msg, rawMsg);
			}, {'noAck': options.ack}, function(err, result) {
				if (err) {
					log.error('larvitamintercom: subscribe(): Subscribe error: ' + err.message);
				}
				cb(err, result);
			});
		});
	});
};

// Publish messages on exchanges.
Intercom.prototype.publish = function(msg, options, cb) {
	const	that	= this;

	let	serializedMsg,
		bufferedMsg;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (cb === undefined) {
		cb = function() {};
	}

	if (options === undefined) {
		options = {};
	}

	if (options.exchange	=== undefined)	options.exchange	= '';
	if (options.type	=== undefined)	options.type	= 'fanout';

	try {
		serializedMsg	= JSON.serialize(msg);
		bufferedMsg	= new Buffer(serializedMsg);
	} catch(err) {
		log.warn('larvitamintercom: publish() - Unserializable msg. Msg follows in separate log entry.');
		log.warn('larvitamintercom: publish() - msg:', msg);
	}

	this.ready(function() {
		that.connection.createChannel(function(err, channel) {
			if (err) {
				log.error('larvitamintercom: publish() - Channel error: ' + err.message);
				cb(err);
				return;
			}

			channel.assertExchange(options.exchange, options.type, {'durable': false});
			log.verbose('larvitamintercom: publish() - Publishing message on exhange "' +  options.exchange + '": ' + serializedMsg);
			channel.publish(options.exchange, '', bufferedMsg);
			cb();
		});
	});
};

// Subscribe on messages on exhange.
Intercom.prototype.subscribe = function(options, msgCb, cb) {
	const	that	= this;

	if (cb === undefined) {
		cb = function() {};
	}

	if (options.exchange	=== undefined)	options.exchange	= '';
	if (options.durable	=== undefined)	options.durable	= false;
	if (options.type	=== undefined)	options.type	= 'fanout';
	if (options.ack	=== undefined)	options.ack	= true;

	this.ready(function() {
		that.connection.createChannel(function(err, channel) {
			if (err) {
				log.error('larvitamintercom: subscribe() - Channel error: ' + err.message);
				cb(err);
				return;
			}

			channel.assertExchange(options.exchange, options.type, {'durable': options.durable});

			channel.assertQueue('', {'exclusive': true}, function(err, q) {
				log.info('larvitamintercom: subscribe() - Subscribing on exchange: "' + options.exchange + '"');
				channel.bindQueue(q.queue, options.exchange, '');
				channel.consume(q.queue, function(msg) {
					let msg;

					try {
						msg	= JSON.parse(rawMsg.content.toString());
					} catch(err) {
						log.warn('larvitamintercom: subscribe() - Unparseable message: ' + rawMsg.content.toString());
						msg = false;
					}

					msgCb(msg, rawMsg);
				}, {'noAck': options.ack}, function(err, result) {
					if (err) {
						log.error('larvitamintercom: subscribe() - Subscribe error: ' + err.message);
					}
					cb(err, result);
				});
			});
		});
	});
};

// Send "connected" event when connection ready.
Intercom.prototype.ready = function(cb) {
	if (this.connected) {
		cb();
		return;
	}

	this.eventEmitter.on('connected', cb);
};

exports.Intercom	= Intercom;
exports.ready	= this.ready;
