// Tab-local reading positions only: no message bodies or credentials are saved.
const storageKey=runId=>'workbench:chat-position:'+runId;
export function rememberChatPosition(chat,runId) {
  const edge=chat.getBoundingClientRect().top;
  const anchor=[...chat.querySelectorAll('article.chat-message')].find(message=>message.getBoundingClientRect().bottom>edge);
  const position={
    atBottom:chat.scrollHeight-chat.clientHeight-chat.scrollTop<=48,
    top:chat.scrollTop,left:chat.scrollLeft,
    anchorId:anchor?.dataset.messageId,offset:anchor?anchor.getBoundingClientRect().top-edge:0,
    expanded:[...chat.querySelectorAll('.chat-long[open]')].map(element=>element.dataset.messageId),
  };
  try{sessionStorage.setItem(storageKey(runId),JSON.stringify(position));}catch{ /* Storage may be disabled; current-page restoration still works. */ }
  return position;
}
export function restoreChatPosition(chat,runId,position) {
  if(!position)try{position=JSON.parse(sessionStorage.getItem(storageKey(runId)));}catch{ /* A missing or invalid position starts at the latest message. */ }
  for(const element of chat.querySelectorAll('.chat-long'))element.open=Array.isArray(position?.expanded)&&position.expanded.includes(element.dataset.messageId);
  if(!position||position.atBottom)chat.scrollTop=chat.scrollHeight;
  else{
    chat.scrollTop=Number(position.top)||0;
    const anchor=[...chat.querySelectorAll('article.chat-message')].find(message=>message.dataset.messageId===position.anchorId);
    if(anchor&&Number.isFinite(position.offset))chat.scrollTop+=anchor.getBoundingClientRect().top-chat.getBoundingClientRect().top-position.offset;
  }
  chat.scrollLeft=Number(position?.left)||0;
  rememberChatPosition(chat,runId);
  chat.addEventListener('scroll',()=>rememberChatPosition(chat,runId),{passive:true});
}
