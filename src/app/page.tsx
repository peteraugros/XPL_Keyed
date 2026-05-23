import MarketingClient from "@/components/MarketingClient";

// Marketing landing — ported from the static design at the project root `index.html`.
// All visual styling lives in globals.css under the same class names as the source.
// `MarketingClient` (Client Component) attaches the interactive behavior: hamburger,
// scroll-reveal observer, and count-up timer.
export default function HomePage() {
  return (
    <>
      <nav>
        <div className="nav-inner">
          <a href="#top" className="logo">
            <div className="logo-mark">K</div>
            <div className="logo-text">XPL KEYED</div>
          </a>
          <div className="nav-links">
            <a href="#how" className="link">How it works</a>
            <a href="#pricing" className="link">Pricing</a>
            <a href="#faq" className="link">FAQ</a>
            <a href="/login" className="link">Sign in</a>
            <a href="/intake" className="btn btn-primary btn-sm">Free trial</a>
          </div>
          <button
            className="hamburger"
            id="hamburger"
            aria-label="Open menu"
            aria-expanded="false"
            aria-controls="mobile-menu"
          >
            <span></span><span></span><span></span>
          </button>
        </div>
      </nav>

      <div
        className="mobile-menu"
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
      >
        <a href="#how" data-close>How it works</a>
        <a href="#pricing" data-close>Pricing</a>
        <a href="#faq" data-close>FAQ</a>
        <a href="/intake" data-close>Free trial</a>
      </div>

      <header className="hero" id="top">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
        <div className="blob blob-4"></div>

        <div className="container">
          <div className="rarity-bars">
            <div></div><div></div><div></div><div></div>
          </div>

          <div className="hero-content">
            <div className="eyebrow">Fortnite Coaching · Battle Royale</div>
            <h1>
              <span className="line-1">Unlock the</span>
              <span className="line-2">Unreal Rank.</span>
            </h1>
            <p className="hero-sub">
              Personalized coaching from{" "}
              <span className="keyed">XPL Keyed</span>, an Unreal ranked tournament player with{" "}
              <span className="js-years-since-c2s2">6</span> years of competitive experience since Chapter 2 Season 2.
            </p>
            <div className="hero-ctas">
              <a href="/intake" className="btn btn-primary">Claim free 30 min call</a>
              <a href="#how" className="btn btn-ghost">See how it works</a>
            </div>
            <div className="credentials">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-silhouette.png"
                alt=""
                aria-hidden="true"
                className="soldier-drop"
              />
              <div className="cred-item">
                <div className="cred-num">Unreal</div>
                <div className="cred-label">Current rank</div>
              </div>
              <div className="cred-item">
                <div className="cred-num">
                  <span className="js-years-since-c2s2">6</span> Years
                </div>
                <div className="cred-label">Competitive</div>
              </div>
              <div className="cred-item">
                <div className="cred-num">C2 S2</div>
                <div className="cred-label">Playing since</div>
              </div>
              <div className="cred-item">
                <div className="cred-num">Tourny</div>
                <div className="cred-label">Competitor</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section id="how" className="section-alt">
        <div className="container">
          <div className="section-eyebrow reveal">How it works</div>
          <div className="section-title-wrap reveal">
            <h2 className="section-title">A weekly rhythm.<br />Real homework.</h2>
          </div>

          <div className="steps">
            <div className="step step-1 reveal">
              <div className="step-day">Sunday</div>
              <div className="step-title">Lesson lands in inbox</div>
              <div className="step-desc">PowerPoint + voiceover walking through that week&apos;s focus area. Built around your specific gaps.</div>
            </div>
            <div className="step step-2 reveal">
              <div className="step-day">Mon to Tue</div>
              <div className="step-title">Study the PowerPoint</div>
              <div className="step-desc">Student reviews on their own time. Rewatch as needed. Take notes.</div>
            </div>
            <div className="step step-3 reveal">
              <div className="step-day">Midweek</div>
              <div className="step-title">30 min live call</div>
              <div className="step-desc">Keyed quizzes the material, answers questions, drills the concepts in real time.</div>
            </div>
            <div className="step step-4 reveal">
              <div className="step-day">Or</div>
              <div className="step-title">VOD review week</div>
              <div className="step-desc">Swap the lesson for a full breakdown of student&apos;s own gameplay, frame by frame.</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="container">
          <div className="section-eyebrow reveal">Curriculum</div>
          <div className="section-title-wrap reveal">
            <h2 className="section-title">Every part of your game.</h2>
          </div>
          <p className="section-lede reveal">Nothing about your game is too small to fix. Lessons rotate through every dimension of high level play.</p>

          <div className="curriculum">
            <div className="skill reveal">
              <svg className="skill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              <div className="skill-title">Building</div>
              <div className="skill-desc">90s, tunnels, retakes, piece control.</div>
            </div>
            <div className="skill reveal">
              <svg className="skill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <line x1="20" y1="4" x2="8.12" y2="15.88" />
                <line x1="14.47" y1="14.48" x2="20" y2="20" />
                <line x1="8.12" y1="8.12" x2="12" y2="12" />
              </svg>
              <div className="skill-title">Editing</div>
              <div className="skill-desc">Speed, accuracy, edit courses, reset edits.</div>
            </div>
            <div className="skill reveal">
              <svg className="skill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
              <div className="skill-title">Aim training</div>
              <div className="skill-desc">Tracking, flicks, recoil, peek timing.</div>
            </div>
            <div className="skill reveal">
              <svg className="skill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
                <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
              </svg>
              <div className="skill-title">Game sense</div>
              <div className="skill-desc">Rotations, zone reads, loadout choices.</div>
            </div>
            <div className="skill reveal">
              <svg className="skill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9 9h.01" />
                <path d="M15 9h.01" />
                <path d="M8 15s1.5 2 4 2 4-2 4-2" />
              </svg>
              <div className="skill-title">Mental game</div>
              <div className="skill-desc">Tilt control, focus, postgame review habits.</div>
            </div>
            <div className="skill reveal">
              <svg className="skill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
              <div className="skill-title">Tournament prep</div>
              <div className="skill-desc">Comp meta, point chasing, late game IQ.</div>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="section-alt">
        <div className="container">
          <div className="section-eyebrow reveal">Pricing</div>
          <div className="section-title-wrap reveal">
            <h2 className="section-title">Start free.<br />Stay only if it works.</h2>
          </div>
          <p className="section-lede reveal">Cancel anytime. Give 24 hours&apos; notice for a session and get a full credit refund; no questions.</p>

          <div className="pricing">
            <div className="price-card reveal" id="trial">
              <div className="price-tier">Free Trial</div>
              <div className="price-amount">$0</div>
              <div className="price-cycle">One 30 minute intro call</div>
              <ul className="price-features">
                <li>Meet Keyed, no commitment</li>
                <li>Skill assessment</li>
                <li>Goal setting conversation</li>
              </ul>
              <a href="/intake" className="btn btn-outline-lime">Book free call</a>
            </div>

            <div className="price-card reveal">
              <div className="price-tier">Single Session</div>
              <div className="price-amount">$24</div>
              <div className="price-cycle">One coaching session, no commitment</div>
              <ul className="price-features">
                <li>Pick the lesson that matters most</li>
                <li>30 min live coaching call on Discord</li>
                <li>Slides and voiceover delivered to keep</li>
              </ul>
              <a href="/single-session" className="btn btn-ghost">Book a single session</a>
            </div>

            <div className="price-card featured reveal">
              <div className="featured-badge">Best Value · Save 42%</div>
              <div className="price-tier">Monthly</div>
              <div className="price-amount">$56<span className="price-unit">/mo</span></div>
              <div className="price-cycle">
                4 lessons · just $14 each vs $24 single
              </div>
              <ul className="price-features">
                <li>Weekly lesson rhythm</li>
                <li>Curriculum that builds week over week</li>
                <li>24 hour cancel = full credit refund</li>
                <li>Cancel anytime, no questions</li>
              </ul>
              <a href="/intake" className="btn btn-primary">Start with the free call</a>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="container">
          <div className="audience">
            <div className="audience-block reveal">
              <div className="section-eyebrow">For Parents</div>
              <div className="section-title-wrap reveal">
                <h3 className="section-title">Screen time<br />with structure.</h3>
              </div>
              <p>Lessons are studied like school material. Your kid reviews a PowerPoint with a voiceover, takes notes, and gets quizzed on it. Sessions are short (30 minutes) and scheduled in advance. No late night calls. No surprise charges.</p>
            </div>
            <div className="audience-block reveal">
              <div className="section-eyebrow">For Players</div>
              <div className="section-title-wrap reveal">
                <h3 className="section-title">Climb faster.<br />Stay there.</h3>
              </div>
              <p>Skip the YouTube rabbit holes. Get a real curriculum from someone who&apos;s actually Unreal and competing in tournaments, and who&apos;s close enough to your age to know what&apos;s holding you back.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="section-alt">
        <div className="container">
          <div className="section-eyebrow reveal" style={{ textAlign: "center" }}>Questions</div>
          <div className="section-title-wrap reveal" style={{ textAlign: "center" }}>
            <h2 className="section-title">Before you book.</h2>
          </div>
          <div style={{ height: 48 }}></div>

          <div className="faq reveal">
            <details>
              <summary>How is this different from YouTube tutorials?</summary>
              <p>YouTube is general. These lessons are built around your specific weaknesses. Keyed watches your gameplay, identifies what&apos;s holding you back, and builds a PowerPoint that targets exactly that. Then he quizzes you on it live.</p>
            </details>
            <details>
              <summary>What platform does my kid need to play on?</summary>
              <p>Any platform, including PC, console, or mobile. The coaching focuses on decision making, mechanics, and game sense, all of which translate across platforms.</p>
            </details>
            <details>
              <summary>How are the live calls done?</summary>
              <p>Discord voice call. 30 minutes, scheduled during the week, in a private channel in Keyed&apos;s coaching server so parents have full visibility. Voice only. No screen sharing or webcam needed.</p>
            </details>
            <details>
              <summary>What&apos;s the cancellation policy?</summary>
              <p>Cancel the subscription anytime, no penalty. For an individual scheduled session, give at least 24 hours&apos; notice and you get full credit toward a future lesson.</p>
            </details>
            <details>
              <summary>Who is XPL Keyed?</summary>
              <p>
                A 14 year old Unreal ranked Fortnite player who&apos;s been competing since Chapter 2 Season 2; that&apos;s{" "}
                <span className="js-years-since-c2s2">6</span> years of high level experience. He plays in tournaments and now coaches other players climbing the ranks.
              </p>
            </details>
            <details>
              <summary>What if my kid is a total beginner?</summary>
              <p>That&apos;s fine, the free intro call is partly a skill assessment. If the fit is right, lessons start from wherever the student is. If not, Keyed will say so honestly.</p>
            </details>
          </div>

          <div className="timer reveal" aria-live="polite">
            <div className="timer-label">Days of experience</div>
            <div className="timer-grid">
              <div className="timer-unit"><div className="timer-num" id="t-years">0</div><div className="timer-unit-label">Years</div></div>
              <div className="timer-sep">:</div>
              <div className="timer-unit"><div className="timer-num" id="t-days">0</div><div className="timer-unit-label">Days</div></div>
              <div className="timer-sep">:</div>
              <div className="timer-unit"><div className="timer-num" id="t-hours">0</div><div className="timer-unit-label">Hours</div></div>
              <div className="timer-sep">:</div>
              <div className="timer-unit"><div className="timer-num" id="t-minutes">0</div><div className="timer-unit-label">Minutes</div></div>
              <div className="timer-sep">:</div>
              <div className="timer-unit"><div className="timer-num" id="t-seconds">0</div><div className="timer-unit-label">Seconds</div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="blob blob-a"></div>
        <div className="blob blob-b"></div>
        <div className="container">
          <h2 className="reveal">Ready to drop in?</h2>
          <p className="reveal">First call is free. 30 minutes with XPL Keyed.</p>
          <a href="/intake" className="btn btn-primary reveal">Claim your free trial call</a>
        </div>
      </section>

      <footer>
        <div className="container">
          <div className="footer-inner">
            <div>© XPL Keyed · Independent Fortnite coaching</div>
            <div>Not affiliated with Epic Games or XP League.</div>
          </div>
        </div>
      </footer>

      <MarketingClient />
    </>
  );
}
