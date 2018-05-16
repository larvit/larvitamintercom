'use strict';

after(function (done) {
	setTimeout(function () {
		process.exit();
		done();
	}, 1000);
});
