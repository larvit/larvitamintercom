'use strict';

const	assert	= require('assert'),
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs');

let	intercom,
	confFile,
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

	it('Send without publish', function(done) {
		const	message	= 'Hello World',
			Intercom	= require(__dirname + '/../index.js').Intercom,
			intercom	= new Intercom(require(confFile).default);

		intercom.send({que: 'testQue1', publish: false}, message);
		done();
	});

	it('Consume', function(done) {
		const	Intercom	= require(__dirname + '/../index.js').Intercom,
			intercom	= new Intercom(require(confFile).default);

		intercom.consume({que: 'testQue1', ack: true}, function(msg) {
			assert.deepEqual(msg.content.toString(), 'Hello World');
			done();
		});
	});


	it('Send & publish', function(done) {
		const	Intercom	= require(__dirname + '/../index.js').Intercom,
			intercom	= new Intercom(require(confFile).default);

		let	exchangeMessageReceived	= false;

		intercom.subscribe({exchange: 'testExchange1', ack: true}, function(msg) {
			assert.deepEqual(msg.content.toString(), 'Hello World');
			exchangeMessageReceived	= true;
		});

		setTimeout(function() {
			const	Intercom	= require(__dirname + '/../index.js').Intercom,
				intercom	= new Intercom(require(confFile).default),
				message	= 'Hello World';

			intercom.send({que: 'testQue2', exchange: 'testExchange1'}, message);

			intercom.consume({que: 'testQue2', ack: true}, function(msg) {
				assert.deepEqual(msg.content.toString(), 'Hello World');
				assert.deepEqual(exchangeMessageReceived, true);
				done();
			});
		}, 500);
	});


	it('Subscribe & Publish', function(done) {
		const	Intercom	= require(__dirname + '/../index.js').Intercom,
			intercom	= new Intercom(require(confFile).default);

		intercom.subscribe({exchange: 'testExchange2', ack: true}, function(msg) {
			assert.deepEqual(msg.content.toString(), 'Hello World');
			done();
		});

		setTimeout(function() {
			intercom.publish({exchange: 'testExchange2'}, 'Hello World');
		}, 500);
	});

});
