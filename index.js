'use strict';

const	log	= require('winston'),
	amqp	= require('amqplib/callback_api'),
	events	= require('events');

function Intercom(url) {
	const that = this;
	this.connected = false;
	this.eventEmitter	= new events.EventEmitter();

	amqp.connect(url, function(err, connection) {
		if (err) {
			log.error('larvitamintercom: Connection error: ' + err.message);
			return;
		}

		that.connection = connection;
		that.connected = true;
		that.eventEmitter.emit('connected');
	});
};

// Sending messages directly to que.
Intercom.prototype.send = function(options, msg, cb) {
	const	that	= this;

	this.ready(function() {
		if (options.que === undefined)	options.que = '';
		if (options.durable === undefined)	options.durable = false;
		if (options.publish === undefined)	options.publish = true;
		if (options.exchange === undefined)	options.exchange = options.que;
		if (cb === undefined) cb = function() { return; };

		that.connection.createChannel(function(err, channel) {
			if (err) {
				log.error('larvitamintercom - send(): Channel error: ' + err.message);
				return;
			}

			channel.assertQueue(options.que);
			log.info('Authoban Intercom - Sending message on que \'' + options.que + '\': ' + msg);
			channel.sendToQueue(options.que, new Buffer(msg));

			if (options.publish === true) {
				that.publish({exchange: options.exchange}, msg, cb);
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
		if (options.que === undefined)	options.que = '';
		if (options.ack === undefined)	options.ack = false;
		if (cb === undefined) cb = function() { return; };

		that.connection.createChannel(function(err, channel) {
			if (err) {
				log.error('larvitamintercom - consume(): Channel error: ' + err.message);
				return;
			}
			channel.assertQueue(options.que);
			log.info('Authoban Intercom - Consuming messages on que: \'' + options.que + '\'');
			channel.consume(options.que, function(msg) {
				msgCb(msg);
			}, {noAck: options.ack}, function(err, result) {
				if (err) {
					log.error('larvitamintercom - subscribe(): Subscribe error: ' + err.message);
				}
				cb(err, result);
			});

		});
	});
};

// Publish messages on exchanges.
Intercom.prototype.publish = function(options, msg, cb) {
	const	that	= this;

	this.ready(function() {
		if (options.exchange === undefined)	options.exchange = '';
		if (options.type === undefined)	options.type = 'fanout';
		if (cb === undefined) cb = function() { return; };

		that.connection.createChannel(function(err, channel) {
			if (err) {
				log.error('larvitamintercom - consume(): Channel error: ' + err.message);
				return;
			}
			channel.assertExchange(options.exchange, options.type, {durable: false});
			log.info('Authoban Intercom - Publishing message on exhange \'' +  options.exchange + '\': ' + msg.toString());
			channel.publish(options.exchange, '', new Buffer(msg));
			cb();
		});
	});
};

// Subscribe on messagenes of exhange.
Intercom.prototype.subscribe = function(options, msgCb, cb) {
	const	that	= this;

	this.ready(function() {
		if (options.exchange === undefined)	options.exchange = '';
		if (options.durable === undefined)	options.durable = false;
		if (options.type === undefined)	options.type = 'fanout';
		if (options.ack === undefined)	options.ack = false;
		if (cb === undefined) cb = function() { return; };

		that.connection.createChannel(function(err, channel) {
			if (err) {
				log.error('larvitamintercom - subscribe(): Channel error: ' + err.message);
				cb(err);
				return;
			}

			channel.assertExchange(options.exchange, options.type, {durable: options.durable});

			channel.assertQueue('', {exclusive: true}, function(err, q) {
				log.info('Authoban Intercom - Subscribing on exchange: \'' + options.exchange + '\'');
				channel.bindQueue(q.queue, options.exchange, '');
				channel.consume(q.queue, function(msg) {
					msgCb(msg);
				}, {noAck: options.ack}, function(err, result) {
					if (err) {
						log.error('larvitamintercom - subscribe(): Subscribe error: ' + err.message);
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
