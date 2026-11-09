const { io } = require('socket.io-client');

async function runLiveTest() {
  console.log('Testing live server at http://localhost:3000...');

  const URL = 'http://localhost:3000';

  // 1. Client A connects and joins
  const clientA = io(URL, { transports: ['websocket'] });
  await new Promise((resolve) => clientA.on('connect', resolve));
  console.log('✔ Client A connected to WebSocket');

  const joinAResult = await new Promise((resolve) => {
    clientA.emit('join', { name: 'Alice' });
    clientA.on('join_success', resolve);
  });
  console.log(`✔ Client A joined successfully as: ${joinAResult.name}`);

  // 2. Client B tries to join with duplicate name
  const clientB = io(URL, { transports: ['websocket'] });
  await new Promise((resolve) => clientB.on('connect', resolve));
  console.log('✔ Client B connected to WebSocket');

  const dupError = await new Promise((resolve) => {
    clientB.emit('join', { name: 'alice' }); // case-insensitive check
    clientB.on('join_error', resolve);
  });
  console.log(`✔ Duplicate name "alice" rejected: "${dupError.message}"`);

  // 3. Client B joins with unique name
  const joinBResult = await new Promise((resolve) => {
    clientB.emit('join', { name: 'Bob' });
    clientB.on('join_success', resolve);
  });
  console.log(`✔ Client B joined successfully as: ${joinBResult.name}`);

  // 4. Test real-time message delivery from Alice to Bob
  const aliceMsgPromise = new Promise((resolve) => {
    clientB.on('message', (msg) => {
      if (msg.message === 'Hello Bob from Alice!') {
        resolve(msg);
      }
    });
  });

  clientA.emit('chat_message', { message: 'Hello Bob from Alice!' });
  const msgReceivedByBob = await aliceMsgPromise;
  console.log(`✔ Message received in real-time by Bob: "${msgReceivedByBob.message}" from "${msgReceivedByBob.name}"`);

  // 5. Test XSS in message text
  const xssPayload = '<script>alert("XSS")</script><img src=x onerror=alert(1)>';
  const xssMsgPromise = new Promise((resolve) => {
    clientA.on('message', (msg) => {
      if (msg.message === xssPayload) {
        resolve(msg);
      }
    });
  });

  clientB.emit('chat_message', { message: xssPayload });
  const xssReceived = await xssMsgPromise;
  console.log(`✔ XSS payload transmitted safely as pure string: "${xssReceived.message}"`);

  // 6. Test XSS in username
  const clientC = io(URL, { transports: ['websocket'] });
  await new Promise((resolve) => clientC.on('connect', resolve));
  const xssNameError = await new Promise((resolve) => {
    clientC.emit('join', { name: '<script>bad()</script>' });
    clientC.on('join_error', resolve);
  });
  console.log(`✔ Malicious username with <script> tag rejected: "${xssNameError.message}"`);
  clientC.disconnect();

  // 7. Test Bad-word filter
  const badWordMsgPromise = new Promise((resolve) => {
    clientA.on('message', (msg) => {
      if (msg.message.includes('***')) {
        resolve(msg);
      }
    });
  });
  clientB.emit('chat_message', { message: 'This is spam and a scam message!' });
  const filteredMsg = await badWordMsgPromise;
  console.log(`✔ Bad words masked by server filter: "${filteredMsg.message}"`);

  // 8. Test Rate Limiting
  let rateLimitHit = false;
  clientA.on('rate_limit', (data) => {
    rateLimitHit = true;
    console.log(`✔ Rate limit triggered as expected: "${data.message}"`);
  });

  for (let i = 0; i < 7; i++) {
    clientA.emit('chat_message', { message: `Flood test message ${i}` });
  }

  await new Promise((resolve) => setTimeout(resolve, 800));

  if (!rateLimitHit) {
    throw new Error('Rate limit was expected to trigger, but did not');
  }

  // Cleanup
  clientA.disconnect();
  clientB.disconnect();

  console.log('\n🎉 ALL LIVE INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

runLiveTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
