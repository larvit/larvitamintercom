'use strict';

const	assert	= require('assert'),
	log	= require('winston'),
	fs	= require('fs');

let	intercom;


// Set up winston
log.remove(log.transports.Console);

before(function(done) {
	let confFile;

	function runAutobahnSetup(confFile) {
		const	Intercom	= require(__dirname + '/../index.js').Intercom;

		log.verbose('Autobahn config: ' + JSON.stringify(require(confFile)));
		intercom	= new Intercom(require(confFile).default);

		intercom.connection.then(done);
	}

	if (process.argv[3] === undefined)
		confFile = __dirname + '/../config/amqp_test.json';
	else
		confFile = process.argv[3].split('=')[1];

	log.verbose('Autobahn config file: "' + confFile + '"');

	fs.stat(confFile, function(err) {
		const altConfFile = __dirname + '/../config/' + confFile;

		if (err) {
			log.info('Failed to find config file "' + confFile + '", retrying with "' + altConfFile + '"');

			fs.stat(altConfFile, function(err) {

				if (err)
					assert( ! err, 'fs.stat failed: ' + err.message);

				if ( ! err)
					runAutobahnSetup(altConfFile);
			});
		} else {
			runAutobahnSetup(confFile);
		}
	});
});


describe('Foo', function() {
	it('Bar', function(done) {

		done();


	});
});
