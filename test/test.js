'use strict';

const	assert	= require('assert'),
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs');

let	confFile,
	altConfFile;

// Set up winston
log.remove(log.transports.Console);

before(function(done) {
	// Set configure file
	if (process.argv[3] === undefined)
		confFile = __dirname + '/../config/amqp_test.json';
	else
		confFile = process.argv[3].split('=')[1];

	log.verbose('Autobahn config file: "' + confFile + '"');

	fs.stat(confFile, function(err) {
		altConfFile = __dirname + '/../config/' + confFile;

		if (err) {
			log.info('Failed to find config file "' + confFile + '", retrying with "' + altConfFile + '"');

			fs.stat(altConfFile, function(err) {

				if (err) assert( ! err, 'fs.stat failed: ' + err.message);
				else if ( ! err) confFile	= altConfFile;

				done();
			});
		} else {
			done();
		}
	});
});

describe('Send, Recieve, Publish and Subscribe', function() {

	it('Test Connection', function(done) {
		const	Intercom	= require(__dirname + '/../index.js').Intercom,
			intercom	= new Intercom(require(confFile).default);

		intercom.ready(done);
	});

	// We do this to ensure intercom is just called once per session.
	it('Test parallel connection', function(done) {
		const	Intercom	= require(__dirname + '/../index.js').Intercom,
			intercom	= new Intercom(require(confFile).default);

		intercom.ready(done);
	});

	it('Send & Consume without publishing', function(done) {
		const	Intercom	= require(__dirname + '/../index.js').Intercom,
			intercom	= new Intercom(require(confFile).default);

		// Consume as opposed to subscribe.
		intercom.consume({que: 'testQue1', ack: true}, function(msg) {
			assert.deepEqual(msg.content.toString(), 'Hello World');
			done();
		}, function(err, result) {
			if (err) throw err;

			assert(result.consumerTag !== undefined);

			// Instantiate a new intercom connection and sends a message.
			const	message	= 'Hello World',
				Intercom	= require(__dirname + '/../index.js').Intercom,
				intercom	= new Intercom(require(confFile).default);

			intercom.send({que: 'testQue1', publish: false}, message);
		});
	});

	it('Send & publish', function(done) {
		const	tasks = [];

		// Subscribe on testExchange1, send and publish message.
		tasks.push(function(cb) {
			const	Intercom	= require(__dirname + '/../index.js').Intercom,
				intercom	= new Intercom(require(confFile).default);

			intercom.subscribe({exchange: 'testExchange1', ack: true}, function(msg) {
				assert.deepEqual(msg.content.toString(), 'Hello World');
				cb();
			}, function(err, result) {
				if (err) throw err;

				assert(result.consumerTag !== undefined);

				const	Intercom	= require(__dirname + '/../index.js').Intercom,
					intercom	= new Intercom(require(confFile).default),
					message	= 'Hello World';

				intercom.send({que: 'testQue2', exchange: 'testExchange1'}, message);
			});
		});

		// Consume messages on testQue2.
		tasks.push(function(cb) {
			const	Intercom	= require(__dirname + '/../index.js').Intercom,
				intercom	= new Intercom(require(confFile).default);

			intercom.consume({que: 'testQue2', ack: true}, function(msg) {
				assert.deepEqual(msg.content.toString(), 'Hello World');
				cb();
			}, function(err, result) {
				if (err) throw err;
				assert(result.consumerTag !== undefined);
			});
		});

		async.series(tasks, function(err) {
			if (err) throw err;
			done();
		});
	});

	it('Subscribe & Publish', function(done) {
		const	Intercom	= require(__dirname + '/../index.js').Intercom,
			intercom	= new Intercom(require(confFile).default);

		intercom.subscribe({exchange: 'testExchange2', ack: true}, function(msg) {
			assert.deepEqual(msg.content.toString(), 'Hello World');
			done();
		}, function(err, result) {
			if (err) throw err;

			assert(result.consumerTag !== undefined);

			const	Intercom	= require(__dirname + '/../index.js').Intercom,
				intercom	= new Intercom(require(confFile).default);

			intercom.publish({exchange: 'testExchange2'}, 'Hello World');
		});
	});

});
