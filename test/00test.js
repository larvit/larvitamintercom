'use strict';

const	intercoms	= [],
	Intercom	= require(__dirname + '/../index.js'),
	assert	= require('assert'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs');

let	confFile;

// Set up winston
log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'colorize':	true,
	'timestamp':	true,
	'level':	'warn',
	'json':	false
});
/**/

before(function(done) {
	this.timeout(20000);

	function instantiateIntercoms(config) {
		const	tasks	= [];

		for (let i = 0; i < 14; i ++) {
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

	this.timeout(10000);

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

	it('send and receive a message to the default exchange', function(done) {
		const	orgMsg	= {'foo': 'bar'},
			tasks	= [];

		this.timeout(2500);
		this.slow(2100); // > 1050 is shown in yellow, 1000ms is setTimeout()

		let	subscribed	= 0,
			consumed	= 0;

		function consume(intercom, cb) {
			intercom.consume(function(msg, ack, deliveryTag) {
				assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false);
				delete msg.uuid;
				assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
				assert(deliveryTag, 'deliveryTag shoult be non-empty');
				consumed ++;
				ack();
			}, cb);
		}

		function subscribe(intercom, cb) {
			intercom.subscribe(function(msg, ack, deliveryTag) {
				assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false);
				delete msg.uuid;
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

	it('send and receive a message to a custom exchange', function(done) {
		const	exchange	= 'customeOne',
			orgMsg	= {'foo': 'bard'},
			tasks	= [];

		this.timeout(2500);
		this.slow(2100); // > 1050 is shown in yellow, 1000ms is setTimeout()

		let	subscribed	= 0,
			consumed	= 0;

		function consume(intercom, cb) {
			intercom.consume({'exchange': exchange}, function(msg, ack, deliveryTag) {
				assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false);
				delete msg.uuid;
				assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
				assert(deliveryTag, 'deliveryTag shoult be non-empty');
				consumed ++;
				ack();
			}, cb);
		}

		function subscribe(intercom, cb) {
			intercom.subscribe({'exchange': exchange}, function(msg, ack, deliveryTag) {
				assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false);
				delete msg.uuid;
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

			intercoms[9].send(orgMsg, {'exchange': exchange}, function(err) {
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
		const	exchange	= 'sameInstance',
			orgMsg	= {'bi': 'bu'};

		intercoms[10].subscribe({'exchange': exchange}, function(msg, ack, deliveryTag) {
			assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false);
			delete msg.uuid;
			assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
			assert(deliveryTag, 'deliveryTag shoult be non-empty');
			ack();
			done();
		}, function(err) {
			if (err) throw err;

			intercoms[10].send(orgMsg, {'exchange': exchange}, function(err) {
				if (err) throw err;
			});
		});
	});

	it('send and receive multiple messages on different Intercoms', function(done) {
		const	exchange	= 'anotherInstance',
			orgMsg1	= {'ba': 'bo'},
			orgMsg2	= {'waff': 'woff'};

		let	msg1Received = 0,
			msg2Received = 0;

		intercoms[11].subscribe({'exchange': exchange}, function(msg, ack) {
			if (JSON.stringify(msg.ba) === JSON.stringify(orgMsg1.ba)) {
				msg1Received ++;
				ack();
			} else if (JSON.stringify(msg.waff) === JSON.stringify(orgMsg2.waff)) {
				msg2Received ++;
				ack();
			}

			if (msg1Received === 1 && msg2Received === 1) {
				done();
			}
		}, function(err) {
			if (err) throw err;

			intercoms[11].send(orgMsg1, {'exchange': exchange}, function(err) {
				if (err) throw err;
			});

			intercoms[12].send(orgMsg2, {'exchange': exchange}, function(err) {
				if (err) throw err;
			});
		});
	});

	it('send and receive multiple messages on the same Intercom', function(done) {
		const	exchange	= 'yetAnotherInstance',
			orgMsg1	= {'bar': 'bor'},
			orgMsg2	= {'waffer': 'woffer'};

		let	msg1Received = 0,
			msg2Received = 0;

		intercoms[13].subscribe({'exchange': exchange}, function(msg, ack) {
			if (JSON.stringify(msg.bar) === JSON.stringify(orgMsg1.bar)) {
				msg1Received ++;
				ack();
			} else if (JSON.stringify(msg.waffer) === JSON.stringify(orgMsg2.waffer)) {
				msg2Received ++;
				ack();
			}

			if (msg1Received === 10 && msg2Received === 10) {
				done();
			}
		}, function(err) {
			if (err) throw err;

			for (let i = 0; i !== 10; i ++) {
				intercoms[13].send(orgMsg1, {'exchange': exchange}, function(err) {
					if (err) throw err;
				});

				intercoms[13].send(orgMsg2, {'exchange': exchange}, function(err) {
					if (err) throw err;
				});
			}
		});
	});

	it('send and receive messages on different exchanges', function(done) {
		const	exchange1	= 'differentExes1',
			exchange2	= 'differentExes2',
			orgMsg1	= {'bar': 'bor'},
			orgMsg2	= {'waffer': 'woffer'},
			tasks	= [];

		let	receivedMsg1	= 0,
			receivedMsg2	= 0;

		tasks.push(function(cb) {
			intercoms[0].subscribe({'exchange': exchange1}, function(msg, ack) {
				assert.deepEqual(msg.bar, orgMsg1.bar);
				receivedMsg1 ++;
				ack();
			}, cb);
		});

		tasks.push(function(cb) {
			intercoms[0].subscribe({'exchange': exchange2}, function(msg, ack) {
				assert.deepEqual(msg.waffer, orgMsg2.waffer);
				receivedMsg2 ++;
				ack();
			}, cb);
		});

		tasks.push(function(cb) {
			intercoms[0].send(orgMsg1, {'exchange': exchange1}, cb);
		});

		tasks.push(function(cb) {
			intercoms[0].send(orgMsg2, {'exchange': exchange2}, cb);
		});

		async.series(tasks, function(err) {
			let	interval;

			if (err) throw err;

			interval = setInterval(function() {
				if (receivedMsg1 === 1 && receivedMsg2 === 1) {
					clearInterval(interval);
					done();
				}
			}, 10);
		});
	});
});
