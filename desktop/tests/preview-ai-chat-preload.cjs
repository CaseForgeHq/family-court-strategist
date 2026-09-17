const {contextBridge,ipcRenderer}=require('electron');
const listen=(channel,callback)=>{const handler=(_event,value)=>callback(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler);};
// A separate manual testing window, with the production ChatGPT bridge and
// fictional case. No account, PIN or case state from the installed app is read.
contextBridge.exposeInMainWorld('strategistDesktop',Object.freeze({
  chatGPTStatus:()=>ipcRenderer.invoke('preview-chat:status'),
  chatGPTLogin:()=>ipcRenderer.invoke('preview-chat:login'),
  chatGPTLogout:()=>ipcRenderer.invoke('preview-chat:logout'),
  chatGPTCancelLogin:()=>ipcRenderer.invoke('preview-chat:cancel-login'),
  chatGPTChat:value=>ipcRenderer.invoke('preview-chat:chat',value),
  chatGPTCancel:()=>ipcRenderer.invoke('preview-chat:cancel'),
  chatGPTNewConversation:()=>ipcRenderer.invoke('preview-chat:new'),
  chatGPTOpenLink:value=>ipcRenderer.invoke('preview-chat:link',value),
  onChatGPTStatus:callback=>listen('chatgpt:status-changed',callback),
  onChatGPTProgress:callback=>listen('chatgpt:progress',callback),
}));
