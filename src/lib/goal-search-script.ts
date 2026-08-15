import { CUSTOM_PATH_HREF } from "@/lib/goals/custom-path";

/**
 * The subject dropdown on the landing page and `/learn`, as ~3KB of inline
 * vanilla script.
 *
 * §8.5.8 — marketing routes ship zero *component-library* JS, and this keeps
 * that rule: no React runtime, no Radix. `ThemeToggleStatic` set the precedent
 * and gives the reason — one import of a client component was the difference
 * between 43KB and 127KB gzipped on the landing page.
 *
 * It exists because the native `<datalist>` it replaced did not work. The
 * markup was correct — the input resolved its list, the options were there —
 * and the control still failed every way a person would use it: clicking the
 * field opens nothing, the popup Chrome eventually shows swallows the next
 * keystroke, it cannot be styled so it lands as a white OS list on a dark
 * page, and iOS Safari shows nothing at all. None of that is fixable from the
 * page. The datalist is gone rather than kept as a fallback, because keeping
 * it meant stripping the input's `list` before the native popup could open —
 * a write to a React-rendered attribute *before* hydration, which is a real
 * hydration mismatch and reported as one. Visitors with JavaScript off still
 * get the whole of `/learn` by submitting the form, including the offer to
 * build a subject we lack, so the honest fallback was always the submit.
 *
 * ## Why it is in `<head>` and not beside the markup
 *
 * It lived inside the `<form>` first, which looks right and is wrong. Next
 * streams the page, and content that arrives in a later chunk is inserted into
 * the document by script rather than parsed into it — and a `<script>` element
 * inserted that way does not run. React re-creates it during hydration, so the
 * dropdown only came alive once hydration finished, and every press before
 * that vanished. That is precisely the "clicking it does nothing" this control
 * was written to fix, reintroduced one layer down.
 *
 * In `<head>` it is parsed and run before the body exists — which is fine,
 * because nothing here touches the DOM until the visitor does.
 *
 * ## Why every listener is on `document`
 *
 * Same failure, different cause: a listener bound to a node found at parse
 * time is lost when React hydrates over that node. Delegating from `document`
 * and resolving elements with `closest` at event time survives it. The theme
 * toggle delegates for exactly this reason.
 *
 * Opening happens on `pointerdown` rather than `click`, because React can
 * replace this subtree mid-press, and a press that starts on the old node and
 * ends on the new one produces no `click` at all. `click` is handled too, so a
 * synthetic click still works; both paths are idempotent.
 *
 * ## Why the panel is measured every time it opens
 *
 * `place` is the one piece of layout the stylesheet cannot do. The landing
 * page's input is the last thing above the fold — it sits ~75px off the bottom
 * of a laptop viewport — so a panel that always drops downward spends all but
 * one row of itself off-screen, and the reader sees a sliver. Everywhere else
 * on the site there is room below and dropping down is right.
 *
 * So: measure the field, and flip the panel above it when what is below is too
 * small to be worth reading — under five rows — and there is more room the
 * other way. The threshold is deliberately blunt rather than "does it fit":
 * a list two rows taller than the space below it should still drop down and
 * scroll, the way every other list on the web does. Flipping on an exact fit
 * makes the panel change sides between one keystroke and the next.
 *
 * Either way the height is clamped to the room that is actually there, which
 * is what stops the list running past the bottom of a short window. Both are
 * inline styles rather than classes, so nothing here depends on Tailwind having
 * seen a class name that only exists inside this string.
 *
 * Escape calls `preventDefault` for a related reason. The field is
 * `type="search"`, and Escape's *native* behaviour there is to empty it — which
 * fires `input`, which re-opens the panel we just shut. Pressing Escape wiped
 * the query and left the list standing, which is both halves of what it was
 * asked to do, backwards.
 */
export const goalSearchScript = `(function(){var D=document;
if(D.goalSearchBound)return;D.goalSearchBound=1;
function parts(t){
if(!t||!t.closest)return null;
var root=t.closest("[data-goal-search]");if(!root)return null;
var list=root.querySelector("[data-goal-list]"),input=root.querySelector("input[name=q]");
return{root:root,input:input,list:list,
custom:root.querySelector("[data-goal-custom]"),
label:root.querySelector("[data-goal-custom-label]"),
opts:Array.prototype.slice.call(list.querySelectorAll("[role=option]"))}}
function shown(p){return p.opts.filter(function(o){return !o.hidden})}
function drop(p){p.opts.forEach(function(o){o.setAttribute("aria-selected","false")});p.input.removeAttribute("aria-activedescendant")}
function at(p){var v=shown(p),i=0;for(;i<v.length;i++)if(v[i].getAttribute("aria-selected")==="true")return i;return -1}
function mark(p,n){var v=shown(p);if(!v.length)return;drop(p);
var o=v[(n+v.length)%v.length];o.setAttribute("aria-selected","true");
p.input.setAttribute("aria-activedescendant",o.id);o.scrollIntoView({block:"nearest"})}
function place(p){var s=p.list.style;s.top="";s.bottom="";s.maxHeight="";
var r=p.input.getBoundingClientRect(),m=16,
b=innerHeight-r.bottom-m,a=r.top-m,n=p.list.scrollHeight,
up=b<Math.min(n,240)&&a>b,room=Math.max(up?a:b,160);
if(up){s.top="auto";s.bottom="calc(100% + 0.5rem)"}
s.maxHeight=Math.min(320,room)+"px"}
function open(p){p.list.hidden=false;p.input.setAttribute("aria-expanded","true");place(p)}
function shut(p){p.list.hidden=true;p.input.setAttribute("aria-expanded","false");drop(p)}
function sift(p){var q=p.input.value.trim(),k=q.toLowerCase();
p.opts.forEach(function(o){if(o!==p.custom)o.hidden=k.length>0&&o.dataset.label.indexOf(k)<0});
p.custom.hidden=k.length===0;p.label.textContent=q;
p.custom.dataset.href=${JSON.stringify(CUSTOM_PATH_HREF)}+(k.length===0?"":"?topic="+encodeURIComponent(q));
var any=p.opts.some(function(o){return o!==p.custom&&!o.hidden});
p.custom.style.borderTopWidth=any?"":"0";p.custom.style.marginTop=any?"":"0";
drop(p)}
function row(t){var o=t&&t.closest?t.closest("[role=option]"):null;return o&&o.closest("[data-goal-list]")?o:null}
function maybeOpen(t){
var p=parts(t);if(!p||(t.closest&&t.closest("button")))return;sift(p);open(p)}
D.addEventListener("pointerdown",function(e){
D.querySelectorAll("[data-goal-search]").forEach(function(r){
if(!r.contains(e.target)){var p=parts(r);if(p)shut(p)}});
if(row(e.target)){e.preventDefault();return}
maybeOpen(e.target)});
D.addEventListener("click",function(e){
var o=row(e.target);if(o){location.href=o.dataset.href;return}
maybeOpen(e.target)});
D.addEventListener("input",function(e){
var p=parts(e.target);if(p){sift(p);open(p)}});
D.addEventListener("keydown",function(e){
var p=parts(e.target);if(!p||e.target.tagName!=="INPUT")return;
if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();
if(p.list.hidden){sift(p);open(p)}mark(p,e.key==="ArrowDown"?at(p)+1:at(p)-1)}
else if(e.key==="Escape"){e.preventDefault();shut(p)}
else if(e.key==="Enter"){var i=at(p);if(i>-1){e.preventDefault();location.href=shown(p)[i].dataset.href}}});
addEventListener("resize",function(){
D.querySelectorAll("[data-goal-search]").forEach(function(r){
var p=parts(r);if(p&&!p.list.hidden)place(p)})})})();`;
