// State
let socket = null;
let myName = null;
let shouldAutoScroll = true;

// DOM Elements
const joinScreen = document.getElementById('join-screen');
const chatScreen = document.getElementById('chat-screen');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const joinError = document.getElementById('join-error');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const messagesContainer = document.getElementById('messages');
const userList = document.getElementById('user-list');
const userCount = document.getElementById('user-count');
const connectionStatus = document.getElementById('connection-status');
const statusText = connectionStatus.querySelector('.status-text');
const toastContainer = document.getElementById('toast-container');

// Load saved name from localStorage (convenience feature)
const savedName = localStorage.getItem('world_chat_name');
if (savedName) {
  nameInput.value = savedName;
}

// Auto-scroll handler
messagesContainer.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
  // If user is within 50px of bottom, auto-scroll is enabled
  shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 50;
});

function scrollToBottom() {
  if (shouldAutoScroll) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Safe string escaping for text content (extra defense in depth)
function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Format timestamp
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Toast notification system
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// Render message - SECURITY: Never uses innerHTML with user content
function renderMessage(msg) {
  if (msg.type === 'system') {
    const systemEl = document.createElement('div');
    systemEl.className = 'system-message';
    systemEl.textContent = msg.message;
    messagesContainer.appendChild(systemEl);
    scrollToBottom();
    return;
  }

  const isMe = msg.name === myName;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isMe ? 'my-message' : 'other-message'}`;

  // Only show sender name for messages from others
  if (!isMe) {
    const sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = msg.name; // Safe: textContent
    wrapper.appendChild(sender);
  }

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Message text - Safe: textContent prevents XSS
  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = msg.message; // Safe: textContent
  bubble.appendChild(text);

  // Timestamp
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = formatTime(msg.timestamp);
  bubble.appendChild(time);

  // Report button for messages from others
  if (!isMe) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const reportBtn = document.createElement('button');
    reportBtn.className = 'report-button';
    reportBtn.title = 'Report message';
    reportBtn.textContent = '🚩';
    reportBtn.addEventListener('click', () => {
      reportMessage(msg.id);
    });

    actions.appendChild(reportBtn);
    bubble.appendChild(actions);
  }

  wrapper.appendChild(bubble);
  messagesContainer.appendChild(wrapper);
  scrollToBottom();
}

// Report message
function reportMessage(messageId) {
  if (!socket) return;
  socket.emit('report', {
    messageId,
    reason: 'User reported via UI'
  });
}

// Update users list
function updateUsersList(users) {
  userCount.textContent = users.length;
  userList.innerHTML = ''; // Safe: clearing

  users.forEach(name => {
    const userEl = document.createElement('div');
    userEl.className = 'user-item';
    userEl.textContent = name === myName ? `${name} (you)` : name; // Safe: textContent
    userList.appendChild(userEl);
  });
}

// Auto-resize textarea
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
});

// Handle enter to send, shift+enter for new line
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener('click', sendMessage);

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !socket) return;

  socket.emit('chat_message', { message: text });
  messageInput.value = '';
  messageInput.style.height = 'auto';
}

// Join Chat
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();

  if (!name) return;

  // Initialize socket connection
  socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  // Socket event listeners
  socket.on('connect', () => {
    connectionStatus.className = 'status-indicator';
    statusText.textContent = 'Connected';

    // Attempt to join with the name
    socket.emit('join', { name });
  });

  socket.on('join_success', (data) => {
    myName = data.name;
    localStorage.setItem('world_chat_name', myName);

    // Switch screens
    joinScreen.classList.remove('active');
    chatScreen.classList.add('active');

    // Clear any previous messages
    messagesContainer.innerHTML = '';

    // Render message history
    if (data.history && Array.isArray(data.history)) {
      data.history.forEach(msg => renderMessage(msg));
    }

    messageInput.focus();
  });

  socket.on('join_error', (data) => {
    joinError.textContent = data.message;
    joinError.classList.remove('hidden');
    socket.disconnect();
  });

  socket.on('message', (msg) => {
    renderMessage(msg);
  });

  socket.on('user_list', (data) => {
    updateUsersList(data.users);
  });

  socket.on('rate_limit', (data) => {
    showToast(data.message, 'warning');
  });

  socket.on('error_msg', (data) => {
    showToast(data.message, 'error');
  });

  socket.on('report_success', (data) => {
    showToast(data.message, 'info');
  });

  socket.on('disconnect', (reason) => {
    connectionStatus.className = 'status-indicator disconnected';
    statusText.textContent = 'Disconnected';
    showToast('Disconnected from server', 'error');
  });

  socket.io.on('reconnect_attempt', () => {
    connectionStatus.className = 'status-indicator reconnecting';
    statusText.textContent = 'Reconnecting...';
  });

  socket.io.on('reconnect', () => {
    connectionStatus.className = 'status-indicator';
    statusText.textContent = 'Connected';
    showToast('Reconnected!', 'info');
    // Re-join with the same name
    if (myName) {
      socket.emit('join', { name: myName });
    }
  });

  socket.io.on('reconnect_failed', () => {
    connectionStatus.className = 'status-indicator disconnected';
    statusText.textContent = 'Connection failed';
    showToast('Could not reconnect to server. Refresh the page.', 'error');
  });
});
