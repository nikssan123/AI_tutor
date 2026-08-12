import { THEME_COOKIE, THEME_STORAGE_KEY } from "@/lib/theme-script";

/**
 * §8.5.8 — "Marketing routes ship zero component-library JS."
 *
 * The Radix-based `ThemeToggle` is a client component: importing it into a
 * marketing route drags React's client runtime and Radix into the first-load
 * bundle and blows the 80KB budget in §13.3. Measured, that one import was the
 * difference between 127KB and 43KB gzipped on the landing page.
 *
 * So the marketing footer gets this instead: a server component that renders
 * three plain buttons plus ~250 bytes of inline script. Same behaviour, same
 * tokens, no framework. §8.5.8 says every marketing-side pattern is achievable
 * in pure CSS and must be — this is that rule applied.
 */
const script = `(function(){var d=document,r=d.documentElement;
d.addEventListener("click",function(e){
var b=e.target.closest("[data-theme-choice]");if(!b)return;
var v=b.getAttribute("data-theme-choice");
r.classList.add("theme-transitioning");
if(v==="system"){delete r.dataset.theme}else{r.dataset.theme=v}
try{v==="system"?localStorage.removeItem("${THEME_STORAGE_KEY}"):localStorage.setItem("${THEME_STORAGE_KEY}",v)}catch(x){}
d.cookie="${THEME_COOKIE}="+v+"; path=/; max-age=31536000; samesite=lax";
d.querySelectorAll("[data-theme-choice]").forEach(function(o){o.setAttribute("aria-pressed",String(o===b))});
requestAnimationFrame(function(){r.classList.remove("theme-transitioning")})
})})();`;

export function ThemeToggleStatic() {
  return (
    <div
      className="inline-flex gap-1 rounded-[var(--radius-pill)] bg-surface p-1"
      role="group"
      aria-label="Appearance"
    >
      {(["light", "dark", "system"] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-theme-choice={value}
          aria-pressed={value === "system"}
          className={[
            "px-4 py-2 rounded-[var(--radius-pill)] capitalize cursor-pointer",
            "text-[length:var(--text-label-size)] font-[550]",
            "text-ink-muted bg-transparent border-0",
            "aria-pressed:bg-accent-weak aria-pressed:text-accent",
            "transition-colors duration-[var(--dur-fast)]",
          ].join(" ")}
        >
          {value}
        </button>
      ))}
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </div>
  );
}
