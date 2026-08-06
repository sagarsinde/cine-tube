// downloader.js — on-page progress toasts for native downloads started from the popup

function showToast(message, isError = false) {
  let toast = document.getElementById('ytc-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ytc-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'ytc-toast-show' + (isError ? ' ytc-toast-error' : '');

  // Auto hide after 4 seconds if it's not a progress update
  if (!message.includes('%')) {
    setTimeout(() => {
      toast.classList.remove('ytc-toast-show');
    }, 4000);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'nativeDownloadUpdate') {
    const data = message.data;
    if (data.status === 'started') {
      showToast(data.message);
    } else if (data.status === 'progress') {
      showToast('Downloading: ' + data.percent + '%');
    } else if (data.status === 'done') {
      showToast(data.message);
      setTimeout(() => {
        const toast = document.getElementById('ytc-toast');
        if (toast) toast.classList.remove('ytc-toast-show');
      }, 4000);
    } else if (data.status === 'error') {
      showToast('Error: ' + data.message, true);
    }
  }
});
