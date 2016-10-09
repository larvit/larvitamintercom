'use strict';

const	intercoms	= [],
	Intercom	= require(__dirname + '/../index.js'),
	assert	= require('assert'),
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs');

let	confFile;

// Set up winston
log.remove(log.transports.Console);
/** /log.add(log.transports.Console, {
	'colorize':	true,
	'timestamp':	true,
	'level':	'debug',
	'json':	false
});
/**/

before(function(done) {
	this.timeout(20000);

	function instantiateIntercoms(config) {
		const	tasks	= [];

		for (let i = 0; i < 11; i ++) {
			tasks.push(function(cb) {
				const	intercom	= new Intercom(config);

				intercoms.push(intercom);
				intercom.on('ready', cb);
			});
		}

		// Wait until all is connected and ready
		async.parallel(tasks, done);
	}

	if (process.env.CONFFILE === undefined) {
		confFile = __dirname + '/../config/amqp_test.json';
	} else {
		confFile = process.env.CONFFILE;
	}

	log.verbose('Autobahn config file: "' + confFile + '"');

	// First look for absolute path
	fs.stat(confFile, function(err) {
		if (err) {

			// Then look for this string in the config folder
			confFile = __dirname + '/../config/' + confFile;
			fs.stat(confFile, function(err) {
				if (err) throw err;
				log.verbose('Autobahn config: ' + JSON.stringify(require(confFile)));
				instantiateIntercoms(require(confFile).default);
			});

			return;
		}

		log.verbose('Autobahn config: ' + JSON.stringify(require(confFile)));
		instantiateIntercoms(require(confFile).default);
	});
});

after(function(done) {
	const	tasks	= [];

	this.timeout(20000);

	for (let i = 0; intercoms[i] !== undefined; i ++) {
		const	intercom	= intercoms[i];
		tasks.push(function(cb) {
			intercom.close(cb);
		});
	}

	async.parallel(tasks, done);
});

describe('Send and receive', function() {

	it('check so the first intercom is up', function(done) {
		const	intercom	= intercoms[0];

		assert.notDeepEqual(intercom.handle,	undefined);
		assert.notDeepEqual(intercom.handle.channel,	undefined);
		done();
	});

	// Sending a message to the default exchange
	it('send and receive a message to the default exchange', function(done) {
		const	orgMsg	= {'foo': 'bar'},
			tasks	= [];

		this.timeout(2500);
		this.slow(2100); // > 1050 is shown in yellow, 1000ms is setTimeout()

		let	subscribed	= 0,
			consumed	= 0;

		function consume(intercom, cb) {
			intercom.consume(function(msg, ack, deliveryTag) {
				assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
				assert(deliveryTag, 'deliveryTag shoult be non-empty');
				consumed ++;
				ack();
			}, cb);
		}

		function subscribe(intercom, cb) {
			intercom.subscribe(function(msg, ack, deliveryTag) {
				assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
				assert(deliveryTag, 'deliveryTag shoult be non-empty');
				subscribed ++;
				ack();
			}, cb);
		}

		tasks.push(function(cb) { consume(intercoms[0],	cb); });
		tasks.push(function(cb) { consume(intercoms[1],	cb); });
		tasks.push(function(cb) { subscribe(intercoms[2],	cb); });
		tasks.push(function(cb) { subscribe(intercoms[3],	cb); });

		async.parallel(tasks, function(err) {
			if (err) throw err;

			intercoms[4].send(orgMsg, function(err) {
				if (err) throw err;

				// Wait for a while to make sure consume() is not ran multiple times.
				// This is not pretty, but I can not think of a better way
				setTimeout(function() {
					assert.deepEqual(consumed,	1);
					assert.deepEqual(subscribed,	2);
					done();
				}, 1000);
			});
		});
	});

	// Sending a message to the default exchange
	it('send and receive a message to a custom exchange', function(done) {
		const	exchangeName	= 'customeOne',
			orgMsg	= {'foo': 'bard'},
			tasks	= [];

		this.timeout(2500);
		this.slow(2100); // > 1050 is shown in yellow, 1000ms is setTimeout()

		let	subscribed	= 0,
			consumed	= 0;

		function consume(intercom, cb) {
			intercom.consume({'exchange': exchangeName}, function(msg, ack, deliveryTag) {
				assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
				assert(deliveryTag, 'deliveryTag shoult be non-empty');
				consumed ++;
				ack();
			}, cb);
		}

		function subscribe(intercom, cb) {
			intercom.subscribe({'exchange': exchangeName}, function(msg, ack, deliveryTag) {
				assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
				assert(deliveryTag, 'deliveryTag shoult be non-empty');
				subscribed ++;
				ack();
			}, cb);
		}

		tasks.push(function(cb) { consume(intercoms[5],	cb); });
		tasks.push(function(cb) { consume(intercoms[6],	cb); });
		tasks.push(function(cb) { subscribe(intercoms[7],	cb); });
		tasks.push(function(cb) { subscribe(intercoms[8],	cb); });

		async.parallel(tasks, function(err) {
			if (err) throw err;

			intercoms[9].send(orgMsg, {'exchange': exchangeName}, function(err) {
				if (err) throw err;

				// Wait for a while to make sure consume() is not ran multiple times.
				// This is not pretty, but I can not think of a better way
				setTimeout(function() {
					assert.deepEqual(consumed,	1);
					assert.deepEqual(subscribed,	2);
					done();
				}, 1000);
			});
		});
	});

	it('send and receive on the same Intercom', function(done) {
		const	exchangeName	= 'sameInstance',
			orgMsg	= {'bi': 'bu'};

		intercoms[10].subscribe({'exchange': exchangeName}, function(msg, ack, deliveryTag) {
			assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
			assert(deliveryTag, 'deliveryTag shoult be non-empty');
			ack();
			done();
		}, function(err) {
			if (err) throw err;

			intercoms[10].send(orgMsg, {'exchange': exchangeName}, function(err) {
				if (err) throw err;
			});
		});
	});
});
