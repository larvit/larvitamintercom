'use strict';

const	intercoms	= [],
	Intercom	= require(__dirname + '/../index.js'),
	//uuidLib	= require('uuid'), // Used to make unique exchange and queue names
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
	'level':	'verbose',
	'json':	false
});
/**/

before(function(done) {
	this.timeout(20000);

	function instantiateIntercoms(config) {
		const	tasks	= [];

		for (let i = 0; i < 10; i ++) {
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
		const	orgMsg	= {'foo': 'bar'};

		this.slow(1050); // > 525 is shown in yellow, 500ms is setTimeout()

		let	//subscribed	= 0,
			consumed	= 0;

		intercoms[0].consume(function(msg, ack) {
			assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
			consumed ++;
			ack();
		});

		intercoms[1].consume(function(msg, ack) {
			assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
			consumed ++;
			ack();
		});

		/*intercoms[2].subscribe(function(msg, ack) {
			assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
			subscribed ++;
			ack();
		});

		intercoms[3].subscribe(function(msg, ack) {
			assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
			subscribed ++;
			ack();
		});*/

		intercoms[4].send(orgMsg, function(err) {
			if (err) throw err;

			// Wait for a while to make sure consume() is not ran multiple times.
			// This is not pretty, but I can not think of a better way
			setTimeout(function() {
				assert.deepEqual(consumed,	1);
				//assert.deepEqual(subscribed,	2);
				done();
			}, 500);
		});
	});

/** /
	it('01: Publish simple message', function(done) {
		const	orgMsg	= {'foo': 'bar'};

		intercom11.subscribe(function(msg) {
			assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));

			done();
		}, function(err) {
			if (err) throw err;

			intercom12.publish(orgMsg);
		});
	});
/**/
/*
	it('Send & Consume without publishing', function(done) {
		const	exchangeName	= 'amq.fanout', //uuidLib.v4(),
			queueName	= uuidLib.v4(),
			orgMsg	= {'msg': 'Hello World'},
			tasks	= [];

		// Subscribe to queue (this shoul never receive messages!)
		tasks.push(function(cb) {
			// Handle incoming subscribed message
			function handleMsg(msg) {
				throw new Error('No message should be received on this channel, but received: ' + JSON.stringify(msg));
			}

			// We subscribe on the exchange == queueName since this is the default if no exchange is given in the send
			intercom11.subscribe({'exchange': exchangeName}, handleMsg, function(err, result) {
				if (err) throw err;

				assert.notDeepEqual(result.consumerTag, undefined);
				cb();
			});
		});

		// Consume from queue
		tasks.push(function(cb) {
			// Handle incoming consumed message
			function handleMsg(msg) {
				assert.deepEqual(JSON.stringify(msg), JSON.stringify(orgMsg));

				// We wait 200ms to make sure no subscribed message is received in handleSub() before exiting
				setTimeout(function() {
					done();
				}, 200);
			}

			// Consume as opposed to subscribe.
			intercom12.consume({'que': queueName}, handleMsg, function(err, result) {
				if (err) throw err;

				assert.notDeepEqual(result.consumerTag, undefined);
				cb();
			});
		});

		// Send to queue
		tasks.push(function(cb) {
			// Instantiate a new intercom connection and sends a message.
			intercom13.send({'que': queueName, 'publish': false}, orgMsg, cb);
		});

		async.series(tasks, function(err) {
			if (err) throw err;
		});
	});
/**/
/*
	it('Send & publish', function(done) {
		const	exchangeName	= uuidLib.v4(),
			queueName	= uuidLib.v4(),
			tasks	= [];

		// Subscribe on testExchange2, send and publish message.
		tasks.push(function(cb) {
			intercom21.subscribe({'exchange': exchangeName}, function(msg) {
				assert.deepEqual(msg.content.toString(), 'Hello World');
				cb();
			}, function(err, result) {
				if (err) throw err;

				assert(result.consumerTag !== undefined);

				const	message	= 'Hello World';
				intercom22.send({'que': queueName, 'exchange': exchangeName}, message);
			});
		});

		// Consume messages on testQue2.
		tasks.push(function(cb) {
			intercom23.consume({'que': queueName}, function(msg) {
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
		const	exchangeName	= uuidLib.v4();

		intercom31.subscribe({'exchange': exchangeName}, function(msg) {
			assert.deepEqual(msg.content.toString(), 'Hello World');
			done();
		}, function(err, result) {
			if (err) throw err;

			assert(result.consumerTag !== undefined);
			intercom32.publish({'exchange': exchangeName}, 'Hello World');
		});
	});
*/
});
