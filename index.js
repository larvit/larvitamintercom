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

/*
	async.series([function(seriesCallback) {
		handle.openAMQPCommunication('guest', 'guest', true, seriesCallback);
	}, function(seriesCallback) {
		handle.queue.declare(1, 'hello');
		handle.once('1:queue.declare-ok', function(channel, method, data) {
			console.log('queue declared');
			seriesCallback();
		});
	}, function(seriesCallback) {
		handle.basic.publish(1, '', 'hello', false, false, function() {
			handle.content(1, 'basic', {}, 'Hello World!', seriesCallback);
		});
	}, function(seriesCallback) {
		setTimeout(function() {
			handle.closeAMQPCommunication(seriesCallback);
		}, 10 * 1000);
	}, function(seriesCallback) {
		handle.socket.end();
		setImmediate(seriesCallback);
	}], function() {
		console.log('all done');
	});*/
}

// Make Intercom an event emitter
Intercom.prototype.__proto__ = EventEmitter.prototype;

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

Intercom.prototype.send = function(message, options, cb) {
	const	properties	= {'content-type': 'application/json'},
		mandatory	= true,
		immediate	= false,
		className	= 'basic',
		that	= this;

	let	stringifiedMsg;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (cb === undefined) {
		cb = function() {};
	}

	if (options.exchange	=== undefined) {	options.exchange	= 'default';	}

	try {
		stringifiedMsg = JSON.stringify(message);
	} catch(err) {
		log.warn('larvitamintercom: send() - Could not stringify message. Message attached to next log call.');
		log.warn('larvitamintercom: send() - Unstringifiable message attached:', message);
		cb(err);
		return;
	}

	log.verbose('larvitamintercom: send() - Sending to exchange: "' + options.exchange + '", message: "' + stringifiedMsg + '"');

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

			that.handle.content(that.channelName, className, properties, stringifiedMsg, function(err) {
				if (err) {
					log.warn('larvitamintercom: send() - Could not send publish content to exchange: "' + options.exchange + '". err: ' + err.message + ' message: "' + stringifiedMsg + '"');
				}

				log.debug('larvitamintercom: send() - Content sent to exchange: "' + options.exchange + '", message: "' + stringifiedMsg + '"');

				cb(err);
			});
		}
	);
};

exports = module.exports = Intercom;
