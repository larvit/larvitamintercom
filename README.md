[![Build Status](https://travis-ci.org/larvit/larvitamintercom.svg?branch=master)](https://travis-ci.org/larvit/larvitamintercom) [![Dependencies](https://david-dm.org/larvit/larvitamintercom.svg)](https://david-dm.org/larvit/larvitamintercom.svg)

# Larvitamintercom

Communication wrapper for rabbitmq in autobahn.

## Usage

### Send

send() to autobahn.

```javascript
const	Intercom	= require('larvitamintercom'),
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

let	message	= {'hello':	'world'},
	options	= {'exchange':	'foo'}; // Will default to "default" if options is omitted

intercom.send(message, options, function(err, msgUuid) {
	// called when message is accepted by queue handler
	// msgUuid will be a unique UUID for this specific message
});
```

#### Default send options:

```javascript
{
	'exchange':	'default',
	'durable':	true
}
```

### Read

There are two types of read operations; "consume" and "subscribe".

A message can only be "consumed" once, but it can be "subscribed" several times, by different readers.

Consumers can be assigned to an exchanged after the message have been sent, and they still receive the message.
However, very importantly, ONE consumer must be assigned before the send happends, or the consumer queue never gets declared!

Subscribers, in contrast, must subscribe BEFORE the message is sent or they will not receive it.

Each subscriber only get each message once.

#### Consume

```javascript
const	Intercom	= require('larvitamintercom'),
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

let options = {'exchange': 'foo'}; // Will default to "default" if options is omitted

intercom.consume(options, function(message, ack, deliveryTag) {
	// message being the object sent with intercom.send()

	// deliveryTag is an identification of this delivery

	// Must be ran! Always! ACK!!
	ack();
	// or
	ack(new Error('Something was wrong with the message'));
}, function(err) {
	// Callback from established consume connection
});

```

##### Default consume options:

```javascript
{
	'exchange':	'default'
}
```

#### Subscribe

```javascript
const	Intercom	= require('larvitamintercom').Intercom,
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

let options = {'exchange': 'default'};

intercom.subscribe(options, function(message, ack, deliveryTag) {
	// message subscribe the object sent with intercom.send()

	// deliveryTag is an identification of this delivery

	// Must be ran! Always! ACK!!
	ack();
	// or
	ack(new Error('Something was wrong with the message'));
}, function(err) {
	// Callback from established subscribe connection
});
```

##### Default subscribe options:

```javascript
{
	'exchange':	'default'
}
```

### Sync between minions

In a clustered application environment it is important to be able to syncronize data. larvitamintercom helps with this by returning an http link to where this dump resides upon request.

#### Require a sync

```javascript
const	dataSection	= 'foobar',
	Intercom	= require('larvitamintercom').Intercom,
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

intercom.getDumpDetails(dataSection, function(err, dumpDetails) {
	if (err) throw err;

	// dumpDetails is a direct response from another minion that sees itself as responsible for data in the selected dataSection
	// For example it could include details about a http link where the data exists, it could be the dump itself (if it is small) or something else
});
```

#### Respond to a sync request

```javascript
const	dataSection	= 'foobar',
	Intercom	= require('larvitamintercom').Intercom,
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

// This will be called each time some other minion asks for dump details
intercom.sendDumpDetails(dataSection, function(cb) {
	const dumpDetails = {
		'host':	'https://foo.larvit.se/getDump',
		'username':	'ghost',
		'password':	'secret'
	};

	cb(null, dumpDetails);
});
```
