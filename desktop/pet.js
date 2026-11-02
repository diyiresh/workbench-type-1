"use strict";
const robot = document.getElementById("orb");
let drag = null;
robot.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  drag = { x:event.clientX, y:event.clientY, moved:false };
  robot.setPointerCapture(event.pointerId);
  window.jarvis.drag("start");
});
robot.addEventListener("pointermove", event => {
  if (!drag) return;
  if (Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>4) drag.moved=true;
  if (drag.moved) window.jarvis.drag("move");
});
robot.addEventListener("pointerup", event => {
  if (!drag) return;
  const moved=drag.moved; drag=null;
  window.jarvis.drag("end");
  if(robot.hasPointerCapture(event.pointerId)) robot.releasePointerCapture(event.pointerId);
  if (!moved) window.jarvis.act("menu");
});
robot.addEventListener("pointercancel", () => { drag=null; window.jarvis.drag("end"); });
robot.addEventListener("lostpointercapture", () => { if(drag){drag=null;window.jarvis.drag("end");} });
robot.addEventListener("click", event => { if(event.detail===0) window.jarvis.act("menu"); });
robot.addEventListener("contextmenu", event => {event.preventDefault();window.jarvis.act("menu");});
window.jarvis.onSpeak(text => {
  if(!window.speechSynthesis) return;
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang="en-US";window.speechSynthesis.speak(utterance);
});
