import { i18next } from '../vendor/workbench.js';
import { EN } from './translations.js';

i18next.init({lng:'zh-CN',fallbackLng:'zh-CN',initImmediate:false,keySeparator:false,nsSeparator:false,resources:{en:{translation:EN},'zh-CN':{translation:{}}},interpolation:{escapeValue:false}});
export function setLanguage(language) {
  const value = language === 'en' ? 'en' : 'zh-CN';
  if (i18next.language !== value) i18next.changeLanguage(value);
  document.documentElement.lang = value;
}
export function language() { return i18next.language; }
export function t(value) { return i18next.t(String(value ?? ''), {defaultValue:String(value ?? '')}); }
function phrase(value) {
  return String(value).split(/(__WBVALUE_\d+__)/g).map(part=>{
    if(/^__WBVALUE_\d+__$/.test(part))return part;
    const match=part.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return match[1]+t(match[2])+match[3];
  }).join('');
}
// Only the developer-authored parts of templates are translated. Interpolated
// project titles, messages, reports, paths and user input remain byte-for-byte.
export function systemFragment(fragment) {
  return fragment.split(/(<[^>]*>)/g).map(part => part.startsWith('<')
    ? part.replace(/(placeholder|title|aria-label)=(['"])([\s\S]*?)\2/g, (_,name,quote,value)=>`${name}=${quote}${phrase(value)}${quote}`)
    : phrase(part)).join('');
}
export function ui(parts,...values) {
  const source=parts.map((part,index)=>part+(index<values.length?`__WBVALUE_${index}__`:'')).join('');
  return systemFragment(source).replace(/__WBVALUE_(\d+)__/g,(_,index)=>values[Number(index)]??'');
}
