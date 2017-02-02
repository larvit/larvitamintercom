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

		for (let i = 0; i < 20; i ++) {
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

/*after(function(done) {
	const	tasks	= [];

	this.timeout(10000);

	for (let i = 0; intercoms[i] !== undefined; i ++) {
		const	intercom	= intercoms[i];
		tasks.push(function(cb) {
			console.log('Closing intercom ' + i);
			intercom.close(function(err) {
				if (err) throw err;

				console.log('Closed intercom: ' + i);
				cb(err);
			});
		});
	}

	async.parallel(tasks, done);
});*/

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
				assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false, 'msg.uuid must be a valid uuid');
				delete msg.uuid;
				assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
				assert(deliveryTag, 'deliveryTag should be non-empty');
				consumed ++;
				ack();
			}, cb);
		}

		function subscribe(intercom, cb) {
			intercom.subscribe(function(msg, ack, deliveryTag) {
				assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false, 'msg.uuid must be a valid uuid');
				delete msg.uuid;
				assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
				assert(deliveryTag, 'deliveryTag should be non-empty');
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
		const	intercom	= {'subscribe': intercoms[10], 'consume': intercoms[11]},
			tasks	= [];

		for (const method of Object.keys(intercom)) {
			tasks.push(function(cb) {
				const	exchange	= 'sameInstance' + method,
					orgMsg	= {'bi': 'bu'};

				intercom[method][method]({'exchange': exchange}, function(msg, ack, deliveryTag) {
					assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false);
					delete msg.uuid;
					assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
					assert(deliveryTag, 'deliveryTag shoult be non-empty');
					ack();
					cb();
				}, function(err) {
					if (err) throw err;

					intercom[method].send(orgMsg, {'exchange': exchange}, function(err) {
						if (err) throw err;
					});
				});
			});
		}

		async.parallel(tasks, done);
	});

	it('send and receive multiple messages on different Intercoms', function(done) {
		const	tasks	= [],
			intercom	= {
				'subscribe': {
					'intercom1': intercoms[12], 'intercom2': intercoms[13]
				},
				'consume': {
					'intercom1': intercoms[14], 'intercom2': intercoms[15]
				}
			};

		for (const method of Object.keys(intercom)) {
			tasks.push(function(cb) {
				const	intercom1	= intercom[method].intercom1,
					intercom2	= intercom[method].intercom2,
					exchange	= 'anotherInstance' + method,
					orgMsg1	= {'ba': 'bo'},
					orgMsg2	= {'waff': 'woff'};

				let	msg1Received = 0,
					msg2Received = 0;

				intercom1[method]({'exchange': exchange}, function(msg, ack) {
					if (JSON.stringify(msg.ba) === JSON.stringify(orgMsg1.ba)) {
						msg1Received ++;
						ack();
					} else if (JSON.stringify(msg.waff) === JSON.stringify(orgMsg2.waff)) {
						msg2Received ++;
						ack();
					}

					if (msg1Received === 1 && msg2Received === 1) {
						cb();
					}
				}, function(err) {
					if (err) throw err;

					intercom1.send(orgMsg1, {'exchange': exchange}, function(err) {
						if (err) throw err;
					});

					intercom2.send(orgMsg2, {'exchange': exchange}, function(err) {
						if (err) throw err;
					});
				});
			});
		}

		async.parallel(tasks, done);
	});

	it('send and receive multiple messages on the same Intercom', function(done) {
		const	intercom	= {'subscribe': intercoms[16], 'consume': intercoms[17]},
			tasks	= [];

		for (const method of Object.keys(intercom)) {
			tasks.push(function(cb) {
				const	exchange	= 'yetAnotherInstance' + method,
					orgMsg1	= {'bar': 'bor'},
					orgMsg2	= {'waffer': 'woffer'};

				let	msg1Received = 0,
					msg2Received = 0;

				intercom[method][method]({'exchange': exchange}, function(msg, ack) {
					if (JSON.stringify(msg.bar) === JSON.stringify(orgMsg1.bar)) {
						msg1Received ++;
						ack();
					} else if (JSON.stringify(msg.waffer) === JSON.stringify(orgMsg2.waffer)) {
						msg2Received ++;
						ack();
					}

					if (msg1Received === 10 && msg2Received === 10) {
						cb();
					}
				}, function(err) {
					if (err) throw err;

					for (let i = 0; i !== 10; i ++) {
						intercom[method].send(orgMsg1, {'exchange': exchange}, function(err) {
							if (err) throw err;
						});

						intercom[method].send(orgMsg2, {'exchange': exchange}, function(err) {
							if (err) throw err;
						});
					}
				});
			});
		}

		async.parallel(tasks, done);
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

	it('send before consumer is up and still receive', function(done) {
		const	exchange	= 'dkfia893M', // Random exchange to not collide with another test
			orgMsg	= {'foo': 'bar'};

		this.timeout(2000);
		this.slow(700);

		intercoms[0].send(orgMsg, {'exchange': exchange, 'forceConsumeQueue': true}, function(err) {
			if (err) throw err;

			setTimeout(function() {
				intercoms[0].consume({'exchange': exchange}, function(msg, ack, deliveryTag) {
					assert.notDeepEqual(lUtils.formatUuid(msg.uuid), false);
					delete msg.uuid;
					assert.deepEqual(JSON.stringify(orgMsg), JSON.stringify(msg));
					assert(deliveryTag, 'deliveryTag shoult be non-empty');
					ack();
					done();
				}, function(err) {
					if (err) throw err;

				});
			}, 200);
		});
	});

	it('send and declare exchanges at the same time', function(done) {
		const	intercom	= intercoms[0],
			exchange	= 'breakCmdChain',
			orgMsg1	= {'blippel': 'bloppel'},
			orgMsg2	= {'maffab': 'berk'};

		let	msg1Received	= 0,
			msg2Received	= 0;

		intercom.subscribe({'exchange': exchange}, function(msg, ack) {
			if (JSON.stringify(msg.blippel) === JSON.stringify(orgMsg1.blippel)) {
				msg1Received ++;
				ack();
			} else if (JSON.stringify(msg.maffab) === JSON.stringify(orgMsg2.maffab)) {
				msg2Received ++;
				ack();
			}

			if (msg1Received === 10 && msg2Received === 10) {
				done();
			}
		}, function(err) {
			if (err) throw err;

			for (let i = 0; i !== 10; i ++) {
				intercom.send(orgMsg1, {'exchange': exchange}, function(err) {
					if (err) throw err;
				});

				// Lets provoke!
				intercom.declareExchange(exchange + '_foobar', function(err) {
					if (err) throw err;
				});

				intercom.send(orgMsg2, {'exchange': exchange}, function(err) {
					if (err) throw err;
				});
			}
		});
	});

	/* Disabled until .cancel() is fixed
	it('should not receive after the consumation is cancelled', function(done) {
		const	consumeIntercom	= intercoms[14],
			sendIntercom	= intercoms[15],
			exchangeYes	= 'receiveAfterConsumeCancel',
			exchangeNo	= 'notReceiveAfterConsumeCancel';

		let	receivedYesMsgs	= 0,
			receivedNoMsgs	= 0,
			consumeInstance;

		this.slow(1000);

		// Handle a message from queue
		function handleNoMsg(message, ack) {
			ack();
			receivedNoMsgs ++;

			if (receivedNoMsgs === 1) {
				consumeInstance.cancel(function(err) {
					if (err) throw err;

					// The callback is sadly not trustworthy. Instead wait a bit and try again
					setTimeout(function() {
						sendAgain();
					}, 200);
				});
			}
		}

		function handleYesMsg(message, ack) {
			ack();
			receivedYesMsgs ++;
		}

		consumeIntercom.consume({'exchange': exchangeNo}, handleNoMsg, function(err, result) {
			consumeInstance = result;

			consumeIntercom.consume({'exchange': exchangeYes}, handleYesMsg, function(err) {
				if (err) throw err;
				sendIntercom.send({'foo': 'bar1'}, {'exchange': exchangeNo}, function(err) {
					if (err) throw err;
				});
				sendIntercom.send({'foo': 'bar1'}, {'exchange': exchangeYes}, function(err) {
					if (err) throw err;
				});
			});
		});


		function sendAgain() {
			sendIntercom.send({'foo': 'bar2'}, {'exchange': exchangeNo}, function(err) {
				if (err) throw err;

				// Wait a while, and then make sure we have not gotten a second message
				setTimeout(function() {
					assert.deepEqual(receivedNoMsgs,	1);
					assert.deepEqual(receivedYesMsgs,	2);
					done();
				}, 200);
			});

			sendIntercom.send({'foo': 'bar2'}, {'exchange': exchangeYes}, function(err) {
				if (err) throw err;
			});
		}
	});

	it('should not receive after the subscription is cancelled', function(done) {
		const	subscribeIntercom	= intercoms[16],
			sendIntercom	= intercoms[17],
			exchangeYes	= 'receiveAfterSubscribeCancel',
			exchangeNo	= 'notReceiveAfterSubscribeCancel';

		let	receivedYesMsgs	= 0,
			receivedNoMsgs	= 0,
			subscribeInstance;

		this.slow(1000);

		// Handle a message from queue
		function handleNoMsg(message, ack) {
			ack();
			receivedNoMsgs ++;

			if (receivedNoMsgs === 1) {
				subscribeInstance.cancel(function(err) {
					if (err) throw err;

					// The callback is sadly not trustworthy. Instead wait a bit and try again
					setTimeout(function() {
						sendAgain();
					}, 200);
				});
			}
		}

		function handleYesMsg(message, ack) {
			ack();
			receivedYesMsgs ++;
		}

		subscribeIntercom.subscribe({'exchange': exchangeNo}, handleNoMsg, function(err, result) {
			subscribeInstance = result;
			sendIntercom.send({'foo': 'bar1'}, {'exchange': exchangeNo}, function(err) {
				if (err) throw err;
			});
			sendIntercom.send({'foo': 'bar1'}, {'exchange': exchangeYes}, function(err) {
				if (err) throw err;
			});
		});

		subscribeIntercom.subscribe({'exchange': exchangeYes}, handleYesMsg, function(err) {
			if (err) throw err;
		});

		function sendAgain() {
			sendIntercom.send({'foo': 'bar2'}, {'exchange': exchangeNo}, function(err) {
				if (err) throw err;

				// Wait a while, and then make sure we have not gotten a second message
				setTimeout(function() {
					assert.deepEqual(receivedNoMsgs,	1);
					assert.deepEqual(receivedYesMsgs,	2);
					done();
				}, 200);
			});

			sendIntercom.send({'foo': 'bar2'}, {'exchange': exchangeYes}, function(err) {
				if (err) throw err;
			});
		}
	});*/
});
