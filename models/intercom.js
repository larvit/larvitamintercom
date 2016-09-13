'use strict';

const	amqp	= require('amqplib'),
	log	= require('winston');

function Intercom(url)	{
	const that = this;

	this.url	= url;

	this.connection = amqp.connect(this.url).then(function(conn) {
		return conn.createChannel();
	}).then(function(ch) {
		that.channel = ch;
	});
};

// Sending messages directly to que.
Intercom.prototype.send = function(options, msg) {
	if (options.que === undefined)	options.que = '';
	if (options.durable === undefined)	options.durable = false;
	if (options.publish === undefined)	options.publish = true;
	if (options.exhange === undefined)	options.exhange = options.que;


	const	that = this,
	ok	= this.channel.assertQueue(options.que);

	return ok.then(function() {
		log.info('Authoban Intercom - Sending message on que \'' + options.que + '\': ' + msg);
		that.channel.sendToQueue(options.que, new Buffer(msg));

		if (options.publish === true) {
			that.publish({exchange: options.exhange, msg});
		}
	});
};

// Consume messages directly from que;
Intercom.prototype.consume = function(options, cb) {
	if (options.que === undefined)	options.que = '';
	if (options.ack === undefined)	options.ack = false;

	const	that = this,
	ok	= this.channel.assertQueue(options.que);

	log.info('Authoban Intercom - Consuming messages on que: \'' + options.que + '\'');

	return ok.then(function() {
		that.channel.consume(options.que, function(msg) {
			cb(msg);
		}, {noAck: options.ack});
	});
};

// Publish messages on exchanges.
Intercom.prototype.publish = function(options, msg) {
	if (options.exchange === undefined)	options.exchange = '';

	const	that	= this,
		ok	= that.channel.assertExchange(options.exchange, 'fanout', {durable: false});

	return ok.then(function() {
		log.info('Authoban Intercom - Publishing message on exhange \'' +  options.exchange + '\': ' + msg.toString());
		that.channel.publish(options.exchange, '', new Buffer(msg));
	});
};

// Subscribe on messagenes of exhange.
Intercom.prototype.subscribe = function(options, cb) {
	if (options.exchange === undefined)	options.exchange = '';
	if (options.durable === undefined)	options.durable = false;
	if (options.type === undefined)	options.type = 'fanout';
	if (options.ack === undefined)	options.ack = false;

	const	that	= this;

	that.channel.assertExchange(options.exchange, options.type, {durable: options.durable});
	const	ok	= that.channel.assertQueue('', {exclusive: true});

	return ok.then(function() {
		that.channel.bindQueue(ok.queue, options.exchange, '');
		log.info('Authoban Intercom - Subscribing on exchange: \'' + options.exchange + '\'');

		that.channel.consume(ok.queue, function(msg) {
			cb(msg);
		}, {noAck: options.ack});
	});

};

exports = module.exports = Intercom;
