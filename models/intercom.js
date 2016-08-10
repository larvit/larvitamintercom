'use strict';

const amqp = require('amqplib'),
      log  = require('winston');

function Intercom(url, que)	{
	const that = this;

	this.url = url;
	this.que = que;

	this.connection = amqp.connect(this.url).then(function(conn) {
		return conn.createChannel();
	}).then(function(ch) {
		that.channel = ch;
	});
};

Intercom.prototype.send = function(options, msg) {
	const that = this,
	      ok   = this.channel.assertQueue(options.que);

	return ok.then(function() {
		log.info('Authoban Intercom - Sending message: ' + msg.toString());
		that.channel.sendToQueue(options.que, new Buffer(msg));
	});
};

Intercom.prototype.consume = function(options, cb) {
	if (options.ack === undefined) {
		options.ack = false;
	}

	const that = this,
	      ok   = this.channel.assertQueue(options.que);

		return ok.then(function() {
			that.channel.consume(options.que, function(msg) {
				cb(msg.content.toString());
			}, {noAck: options.ack});
		});
};

exports = module.exports = Intercom;
