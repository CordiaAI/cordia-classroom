# Cordia Classroom Personalization Features: US Legal and Privacy Requirements (Research Brief for Counsel)

**Not legal advice.** This brief is research to prepare for a conversation with a licensed attorney. It is current as of November 3, 2026. Items marked **⚖️ LAWYER** need a lawyer's judgment before launch.

The main finding: as long as Cordia stays a direct-to-student consumer app for adult college students, FERPA and the K-12 student-privacy statutes (SOPIPA, SOPPA, NY Ed Law 2-d and similar) mostly do **not** apply to it directly. The real exposure comes from four other places:
- **Section 5 of the FTC Act.** Privacy promises, AI claims, outcome claims and subscriptions are all judged under it.
- **State health-data laws with no size threshold.** Washington's My Health My Data Act is the main one, and it could reach test-anxiety answers.
- **State comprehensive privacy laws** whose thresholds are falling, such as Connecticut's 35,000-consumer threshold since July 1, 2026.
- **The high-school expansion.** It triggers COPPA, under-18 bans on targeted advertising and sale, and possibly K-12 operator laws.

## TL;DR

- **Canvas grades and study data:** FERPA mainly governs schools, not an app a student connects on their own. Cordia's duties come from its own privacy promises (FTC Act §5) and state privacy laws. That changes the moment Cordia contracts with a school or instructor and becomes a "school official." From then on, use and redisclosure limits apply.
- **Personality and anxiety answers:** treat test-anxiety and other mental-health-adjacent answers as consumer health data or sensitive data. Washington's MHMDA has no revenue or volume threshold, requires opt-in consent and gives consumers a private right of action. Collect these answers only with a separate opt-in, or don't collect them. Personality-style items are lower risk but still need minimization and clear notice.
- **High school, AI claims and exam names:** expanding to under-18s (and especially under-13s) is a regulatory step-change. It brings the amended COPPA Rule (compliance date April 22, 2026) and Connecticut's under-18 ban on targeted ads and sale. If Cordia markets to K-12 school purposes, SOPIPA-style laws may apply too. Separately, every "proven," "boosts pass rates" or "no hallucination" claim needs competent and reliable evidence before it runs. Exam names can be used only as nominative references, with each owner's disclaimers, and never with real exam questions.

## How to read the certainty ratings

- **[STATUTE/RULE]**: clear statutory or regulatory requirement.
- **[GUIDANCE]**: agency guidance or enforcement pattern. Not binding, but strongly predictive.
- **[INDUSTRY]**: carrier or industry code (e.g., CTIA, 10DLC). Contractually enforced through vendors.
- **[BEST PRACTICE]**: prudent, not legally required.
- **[UNSETTLED]**: contested, in litigation, or not verified in this research.

## Key Findings

1. **"FERPA always applies to edtech" is a myth.**
   - FERPA restricts schools' disclosure of education records [STATUTE/RULE].
   - The Department of Education's eligible-student guide says that under the "school official" exception, a school may disclose records without consent to contractors such as software providers that perform institutional functions.
   - CRS explains that providers receiving records under that exception "may only use those records for the specific purpose for which they were disclosed."
   - A student who pulls their own grades via a personal access token and hands them to Cordia is the eligible student acting on their own records. Cordia is not receiving them from the school under an exception.
   - **Counsel should confirm this reading** ⚖️ LAWYER. No ED guidance located in this research squarely addresses student-generated API tokens [UNSETTLED].

2. **K-12 student-privacy laws are scoped to K-12 operators.**
   - California SOPIPA defines an "operator" as one "with actual knowledge that the site, service, or application is used primarily for K–12 school purposes and was designed and marketed for K–12 school purposes."
   - A secondary guide to Illinois SOPPA says "Higher education is outside its scope."
   - A college-only Cordia is likely outside these laws [GUIDANCE/secondary]. An ACT/SAT product marketed to high schools may be inside them ⚖️ LAWYER.

3. **Washington MHMDA is the biggest sensitive-data risk for a small startup.**
   - It defines consumer health data as "personal information that is linked or reasonably linkable to a consumer and that identifies the consumer's past, present, or future physical or mental health status" [STATUTE].
   - It defines "collect" to include "infer, derive."
   - Sidley Austin notes "there is no revenue, data processing, or consumer threshold for an entity to be classified as a 'regulated entity,'" and that violations are enforceable under Washington's Consumer Protection Act by the Attorney General and by private parties.
   - Whether test-anxiety items "identify mental health status" is **unsettled** ⚖️ LAWYER.

4. **Thresholds matter. Cordia is likely below some of them today and above others.**
   - **CCPA:** applies at over $26,625,000 in revenue, at buying/selling/sharing personal information of 100,000+ California consumers or households, or at 50%+ of revenue from selling or sharing.
   - **Connecticut CTDPA (as amended by SB 1295), since July 1, 2026:**
     - the general threshold is 35,000 consumers;
     - **no threshold** applies if you process sensitive data or sell personal data;
     - targeted advertising to, and sale of data of, minors under 18 is banned "regardless of whether consent is obtained."

5. **California's ADMT and risk-assessment regulations took effect January 1, 2026.**
   - ADMT used for "significant decisions" (education is a listed domain) must comply by January 1, 2027.
   - Risk-assessment attestations are due April 1, 2028 [STATUTE/RULE]. They apply only if Cordia is a CCPA "business."
   - A study-plan recommender probably isn't making a "significant decision" about access to education. Counsel should confirm ⚖️ LAWYER.

6. **The Colorado AI Act has been rewritten.**
   - SB 26-189, signed May 14, 2026, repealed and replaced SB 24-205.
   - It narrows the law to a disclosure and transparency model and becomes effective January 1, 2027 (Epstein Becker Green); Eckert Seamans notes that a federal court stayed enforcement of the original law on April 27, 2026, and that enforcement "remains contingent on completion of Attorney General rulemaking" [STATUTE].

7. **The FTC is actively policing AI claims and edtech data handling.**
   - **Operation AI Comply** (launched September 2024) continued under the current Commission. Examples:
     - DoNotPay settled for $193,000 over its "robot lawyer" claims;
     - Workado's "98% accurate" AI-detector claim drew a complaint.
   - **Illuminate Education:** the FTC gave final approval to a modified order on June 5, 2026, after a 2021 breach affecting 10.1 million students; per Hunton, it requires the company to delete unnecessary student data, "publish and comply with a data retention schedule," and run a security program [GUIDANCE/enforcement].

8. **The federal click-to-cancel rule is dead for now.**
   - The Eighth Circuit vacated it on July 8, 2025.
   - The FTC published an ANPRM to restart the rulemaking in March 2026.
   - ROSCA, FTC Act §5 and state auto-renewal laws still apply [STATUTE].

## Requirements by Feature

### 1. Canvas grades and study-data link (feedback loop)

**Context:** Cordia reads grades, assignments, exam dates and announcements via a student's personal access token (or .ics feed). The adaptive engine will link study behavior to grades.

**Must do**
- **Keep privacy-policy and in-app statements accurate**, and treat them as binding.
  - FTC §5 deception theory applies to privacy promises [STATUTE/GUIDANCE].
  - The Illuminate complaint alleged the company "repeatedly told school clients that it safeguarded student data using strong protections" while storing data in plaintext.
- **Use reasonable security and a written retention/deletion schedule** [GUIDANCE]. The Illuminate order requires a company to "publish and follow a data retention schedule" and delete unnecessary data.
  - Cordia's AES-256-GCM token encryption is good.
  - Extend encryption and access controls to derived learner profiles and grade-behavior joins.
- **Honor state privacy rights wherever Cordia crosses a threshold** (access, deletion, correction, opt-out of targeted ads/sale/profiling). Connecticut's 35,000-consumer threshold is the lowest general one found [STATUTE].
- **If Cordia ever contracts with a school or instructor ⚖️ LAWYER:**
  - Cordia likely becomes a FERPA "school official" and must stay under the school's "direct control."
  - Use data only for the outsourced function.
  - Do not redisclose without consent (34 CFR §99.33) [STATUTE/RULE].
  - Expect data-sharing agreements. In California, AB 1584 (Ed. Code §49073.1) contract terms apply to K-12 local educational agencies. In New York, Ed Law 2-d applies to contractors of educational agencies [UNSETTLED: specific contract terms not verified in this research].
  - Instructor-level contracts are especially murky. An individual instructor usually cannot bind the institution. Get this reviewed.

**Should do**
- **Keep the connection student-initiated, read-only and revocable.** Show a "Disconnect Canvas and delete synced data" control [BEST PRACTICE].
- **Use separate, granular consents:** (a) sync course data, (b) sync grades, (c) use grades to personalize, (d) use de-identified data to improve defaults. Linking grades to behavior is the most sensitive inference and deserves its own toggle [BEST PRACTICE].
- **Check institutional acceptable-use policies** ⚖️ LAWYER. Some schools disable student tokens, which is why the .ics fallback exists. Using a token against a school's terms is a contract/ToS risk, not a FERPA one [UNSETTLED].
- **Minimize announcements and email content.** Store extracted dates, not full email bodies, from professors' date-change emails.

**Avoid**
- Telling users or schools "we are FERPA compliant" as a blanket claim. It implies a status Cordia doesn't hold, and an inaccurate claim is a §5 risk.
- Using grades or grade-linked profiles for advertising, or selling them.
- Sharing instructor-identifiable or classmate-identifiable grade data (e.g., "you scored below 80% of your class") without strong aggregation.

### 2. Onboarding personality-style and test-anxiety questions

**Must do**
- **Classify each question first.**
  - Major, year and goals: ordinary personal data.
  - Mini-IPIP / IPIP-50 personality traits: generally not listed as "sensitive" in state laws [UNSETTLED].
  - Test-anxiety or stress items: plausibly "mental health status" under Washington MHMDA, Nevada's consumer health data law and Connecticut's consumer-health-data provisions. Plausibly "mental or physical health condition" sensitive data under Colorado, Virginia, Oregon and similar laws [UNSETTLED ⚖️ LAWYER].
- **If you collect anxiety data, comply with MHMDA**, which has no size threshold [STATUTE]:
  - a separate Consumer Health Data Privacy Policy;
  - opt-in consent to collect, and **separate** consent to share;
  - a signed-authorization regime for any "sale";
  - consumer access and deletion rights.
  - Commentary confirms that a Connecticut consumer health data controller is covered "with no revenue or processing thresholds" and "need[s] consent to process or sell consumer health data."
- **California CCPA (if a "business"):** health-related information is sensitive personal information. If used beyond what's "reasonably necessary" for the service, the "Limit the Use of My Sensitive Personal Information" right applies [STATUTE; specific regulation text not fetched in this research].

**Should do**
- **Make sensitive items optional, skippable and clearly labeled**, with a "why we ask" explanation and no impact on core functionality [BEST PRACTICE].
- **Prefer behavioral signals** (e.g., confidence ratings, latency) to direct anxiety questions. Ask whether an indirect "how do you feel before exams?" item is truly needed.
- **Store raw answers separately** from derived traits. Apply short retention (e.g., delete raw item responses after scoring) and let users view and delete their profile.
- **Do not present results as a diagnosis.** Keep the crisis screen (988) messaging non-clinical. The FTC has warned against unsubstantiated health or therapeutic AI claims [GUIDANCE].
- **FTC Health Breach Notification Rule:** probably not triggered. It targets vendors of personal health records drawing from multiple sources, and a study app with an anxiety item is unlikely to be one [UNSETTLED; HBNR text not fetched in this research ⚖️ LAWYER].

**Avoid**
- Using anxiety or personality data for marketing, ad targeting, or pricing.
- Sharing these answers with any third party beyond processors (Anthropic, Supabase) bound by contract.
- Geofencing, or inferring health status from other data without consent. MHMDA's "collect" includes "infer, derive."

### 3. Adaptive engine and learner profile (event logging, FSRS, contextual bandit, A/B tests)

**Must do**
- **Disclose profiling plainly:** what is logged (format, correctness, confidence, latency, explanation views) and how it changes what the student sees [STATUTE under state privacy laws' notice duties].
- **Connecticut (since July 1, 2026), if covered:**
  - expanded profiling rights;
  - a profiling impact-assessment duty starting August 1, 2026;
  - a required privacy-notice statement on whether personal data is used "for the purpose of training large language models" [STATUTE].
- **California (if a "business"):** run a risk assessment for processing that presents significant risk, including sensitive data. Processing that existed before January 1, 2026 must have a completed assessment by December 31, 2027 [STATUTE/RULE].

**Should do**
- **A/B tests against a control group:** make sure no control arm withholds study features in a way that could plausibly hurt grades without disclosure. Keep "control" to non-material variations (UI, ordering).
  - Commercial A/B testing is generally not federally regulated "human subjects research" unless federally funded.
  - Publishing results with a university partner could trigger IRB review ⚖️ LAWYER [UNSETTLED].
- **Document the model** (inputs, purpose, retention). This prepares Cordia for California ADMT and Colorado's January 1, 2027 transparency model if they ever apply.
- **Give users a "reset my profile" control and an explanation view** ("We showed this because…").

**Avoid**
- Using the learner profile for anything that resembles an eligibility decision (e.g., scholarship, admission or placement recommendations to third parties). That could pull in ADMT "significant decision" rules.

### 4. Study plans (diagnostic + material + profile + test date)

**Must do**
- **Keep plan outputs framed as recommendations, not guarantees.** Any implied outcome ("follow this plan to pass") is an advertising claim needing substantiation [GUIDANCE].
- **Only use profile inputs the student consented to.** If anxiety data was declined, the plan must work without it.

**Should do**
- **Show the basis of a plan** (diagnostic results, days left, mastery estimates). Let students edit it.
- **NCLEX practice for nursing:** keep a clear "educational practice, not clinical advice" disclaimer [BEST PRACTICE].

**Avoid**
- Marketing a plan as "guaranteed" without an honest, prominent guarantee policy that is actually honored.

### 5. High school expansion (ACT/SAT), including texting minors

**Must do (under 13), COPPA** [STATUTE/RULE]
- **The amended COPPA Rule** was published April 22, 2025 and took effect June 23, 2025. The compliance date was April 22, 2026, and has passed. It requires:
  - separate verifiable parental consent for third-party disclosures not integral to the service;
  - disclosure of the specific "internal operations" purposes;
  - a written information-security program;
  - a published data retention policy for children's data.
- **Civil penalties reach up to $53,088 per violation**, per the FTC's COPPA FAQ (inflation-adjusted January 2025).
- **Simplest path:** keep a neutral age screen and block under-13 users from the consumer product. Reaching under-13s through schools requires a separate school-authorization analysis ⚖️ LAWYER.

**Must do (13–17)**
- **Connecticut, since July 1, 2026:** no targeted advertising to, and no sale of data of, anyone known or willfully disregarded to be 13–17, even with consent. Also:
  - profiling minors requires consent;
  - "any system design feature intended to significantly increase, sustain, or extend a minor's use" is prohibited.
  - The engagement-feature ban needs a look at streaks, notifications and the SMS check-ins ⚖️ LAWYER [STATUTE].
- **California CCPA:** opt-in consent is required to sell or share data of consumers under 16 [STATUTE; recalled from Civ. Code §1798.120(c), not fetched in this research].
- **K-12 operator laws** (SOPIPA, Illinois SOPPA, NY Ed Law 2-d, Colorado student data law): these apply only if the product is "designed and marketed for K-12 school purposes." SOPIPA doesn't require a contract with a school. Marketing ACT/SAT prep to individual teens and parents may fall outside; marketing to schools and counselors likely falls inside ⚖️ LAWYER [STATUTE/GUIDANCE].
  - Where SOPIPA applies, it bans targeted advertising and selling data, and bars amassing a profile except for K-12 purposes.
  - It does allow using de-identified data to improve products and "to demonstrate the effectiveness of the operator's products… including in their marketing."
- **Other minors' laws to check** [UNSETTLED; statuses not verified in this research, ⚖️ LAWYER]:
  - New York Child Data Protection Act;
  - Maryland Age-Appropriate Design Code (Kids Code; litigation);
  - California Age-Appropriate Design Code (enjoined in litigation as of last known status);
  - Texas SCOPE Act (partly enjoined; aimed at digital services with social features);
  - Colorado's minors amendment to the CPA;
  - federal COPPA 2.0 / KOSA. Not confirmed enacted as of this writing; verify.

**Texting minors (Cordia Assistant)**
- **TCPA:**
  - automated informational texts need "prior express consent";
  - marketing texts need "prior express written consent" (47 C.F.R. §64.1200(a)(1)–(2)) [STATUTE/RULE; summarized by research subagent, rule text not fetched; verify].
  - A minor's own consent to receive texts is legally uncertain. Get parent/guardian consent for under-18 numbers ⚖️ LAWYER [UNSETTLED].
- **FCC consent-revocation rule:**
  - Since April 11, 2025, consumers may revoke by "any reasonable means." Revocations must be honored within 10 business days. Words like "stop," "quit," "end," "cancel," "unsubscribe" are valid revocations [STATUTE/RULE, per law-firm summaries].
  - The "revoke-all" portion (one opt-out applies to unrelated messages) was waived to January 31, 2027 (Wiley).
  - A later FCC item (FCC 26-67) may let callers designate an exclusive revocation method. Its final status was **not verified** [UNSETTLED].
  - Cordia's STOP/START/HELP/PAUSE handling should also catch natural-language opt-outs.
- **CTIA Messaging Principles (May 2023)** [INDUSTRY]:
  - informational texts need "EXPRESS CONSENT"; promotional texts need "EXPRESS WRITTEN CONSENT";
  - a call-to-action must disclose the program, the sending number, the organization's identity, fees, and opt-out and terms;
  - recurring programs need a confirmation message stating frequency;
  - opt-in records should be kept (timestamp, medium, screenshot of the consent flow, IP address, phone number).
  - CTIA warns that "Adding a call-to-action (e.g., a coupon code to an informational text) may place the message in the promotional category." This matters for any "Upgrade to Pro" text.
  - No CTIA rule specific to 13–17-year-olds was found [UNSETTLED].
- **10DLC:** Twilio states "Anyone sending SMS/MMS messages over a 10DLC number from an application to the US must register for A2P 10DLC." Brand and campaign registration requires sample messages [INDUSTRY]. A minors-facing campaign may draw extra carrier vetting [UNSETTLED].
- **State mini-TCPAs:**
  - **Florida:** the 8 a.m.–8 p.m. limit and the three-per-24-hours cap sit in the Florida Telemarketing Act (§501.616(6)). The FTSA (§501.059) governs "telephonic sales calls" including texts.
  - **Oklahoma:** its Telephone Solicitation Act has equivalent 8–8 and three-per-day limits.
  - Both reach **solicitations**, not purely informational reminders [STATUTE].
  - Still, apply 8 a.m.–8 p.m. recipient-local quiet hours to all texts as a best practice, especially for minors.

**Should do**
- Keep the adult product's 18+ gate. Build a separate teen flow with parent verification rather than loosening the gate.
- Turn off anonymous guide-sharing by default for teen accounts.

**Avoid**
- Any promotional SMS to minors.
- Engagement-maximizing nudges for under-18s in Connecticut.
- Collecting under-13 data "by accident" via a free-text age field.

### 6. Anonymized and aggregated cross-student patterns (defaults, model training, marketing)

**Must do**
- **CCPA "deidentified"** (Civ. Code §1798.140(m)) requires that the information "cannot reasonably be used to infer information about, or otherwise be linked to, a particular consumer," **and** that the business [STATUTE]:
  - (1) "Takes reasonable measures to ensure that the information cannot be associated with a consumer or household";
  - (2) "Publicly commits to maintain and use the information in deidentified form and not to attempt to reidentify the information";
  - (3) "Contractually obligates any recipients of the information to comply."
  - Put the public commitment in the privacy policy. Put the contractual clause in vendor and partner agreements.
- **Washington MHMDA excludes de-identified data**, so de-identification is a real compliance lever for health-adjacent signals [STATUTE].

**Should do**
- **Use small-cell suppression:**
  - PTAC: "Many statisticians consider a cell size of 3 to be the absolute minimum needed to prevent disclosure, though larger minimums (e.g., 5 or 10) may be used." ED "does not mandate a particular method."
  - NCES reports state minimums "ranging from 5 to 30 and a modal category of 10 (used by 39 states)" [GUIDANCE; foundational 2010–2013 sources, still the main ED references].
  - **Adopt n ≥ 10 per reported cell**, with complementary suppression. PTAC warns "simple suppression of small subgroups may not be sufficient."
- **Course-code sharing is a re-identification hotspot.** A small section plus major and year can identify a student. Apply the threshold to any "students in your course did X" feature.
- **HIPAA analogs** (Safe Harbor's removal of 18 identifiers; Expert Determination) are useful benchmarks but don't legally apply to Cordia [BEST PRACTICE; HIPAA text not fetched in this research].
- **Use differential privacy or k-anonymity for published statistics.** Keep raw event logs out of marketing analytics.
- **AI vendors:** confirm by contract that Anthropic, Composio and other processors do not train on Cordia user data. Disclose LLM-training use where Connecticut requires it [STATUTE for the CT disclosure].

**Avoid**
- Believing "anonymized data is always safe." The CCPA standard is functional ("cannot reasonably be… linked") plus process duties. Hashing IDs is not de-identification.
- Marketing statistics derived from small cohorts (e.g., "nursing students at X University scored…").

### 7. Exam prep paths and trademark use

**Must do**
- **Never use real or retired live exam questions without a license** [STATUTE: copyright].
  - NCBE: "The MBE is owned by NCBE and is a secure exam protected by US copyright laws." Its NextGen sample questions say "commercial use is prohibited without a license from NCBE."
  - LSAC: "no person or entity may use LSAT content without obtaining a license."
  - AAMC test-takers acknowledge AAMC "is the exclusive owner of all rights in the MCAT exam."
  - Precedents:
    - College Board sued Karen Dillard's College Prep over illegally obtained live SAT/PSAT forms; KDCP agreed to pay $1 million (2008).
    - ETS's suit over copied GRE questions settled with Kaplan paying $150,000 (late 1990s; older foundational precedent).
    - LSAC filed a 2025 complaint in E.D. Pa. against defendants who used its marks and content without a license.
- **AI-generated "expert-verified" items:** make sure they aren't memorized reproductions of licensed or secure items. Have experts check for near-duplicates ⚖️ LAWYER.
- **Use marks only nominatively, with symbols and disclaimers:**
  - **LSAC:** use the ® symbol and the footnote "LSAT® is a trademark registered by LSAC, which is not affiliated with, and does not endorse, this [product/site]."
    - On websites it must appear at the bottom of the home page and of every page using the mark. A Terms page alone "does NOT satisfy these Guidelines."
    - Don't put LSAT in product names, domains or metatags.
    - Title format: "Smith's App for the LSAT®," not "LSAT Preparation and Practice App."
    - LSAC states that "any advertisement for an LSAT® tutoring company is **not allowed** under fair use" without permission. This is LSAC's position; how far it would hold in court is contested ⚖️ LAWYER [UNSETTLED].
  - **College Board (SAT®, PSAT/NMSQT®, AP®):** don't combine its marks with your own (e.g., not "ACME's CLEP Study Guide"). Don't imply affiliation. Use the form "SAT® is a trademark registered by the College Board, which is not affiliated with, and does not endorse, this website."
  - **AAMC:** licensees must limit use to trademark "fair use" "accompanied with the appropriate registration symbol and statement to the AAMC's ownership."
  - **NCSBN:** lists NCLEX®, NCLEX-RN®, NCLEX-PN® as registered marks that "may not be used or reproduced without written permission." Major prep companies use the disclaimer "NCLEX-RN® is a registered trademark of the National Council of State Boards of Nursing, Inc., which is not affiliated with Kaplan and was not involved in the production of, and does not endorse, this product."
  - **NCBE:** says its marks (MBE, UBE, MEE, MPT, MPRE) require "prior express written consent." Prep companies still use nominative attributions ⚖️ LAWYER.
  - **ACT, ETS (GRE/TOEFL), AICPA/NASBA (CPA Exam):** published guidelines were not reviewed in this research. Apply the same pattern and check each owner's page [UNSETTLED].

**Should do**
- Keep Cordia's brand visually dominant. LSAC requires the mark to be "smaller in font and size, and different in color."
- Don't call content "official," "real," or "actual exam questions" unless licensed. Use "practice questions modeled on the [exam] format."

**Avoid**
- Exam logos (prohibited without a license by LSAC and others).
- Possessive or plural forms ("LSAT's").
- Names like "Cordia NCLEX Path" without separation. Use "Cordia Exam Path for the NCLEX-RN® exam."
- Paid search keywords and ad copy using marks without legal review.

### 8. Marketing claims ("proven," "boosts pass rates," "students score X higher," "unlimited," "no hallucination")

**Must do**
- **Have substantiation before the claim runs** [STATUTE/GUIDANCE]. Operation AI Comply's theory: claims about AI capabilities "must be substantiated by competent and reliable evidence."
  - **"Proven" / "boosts pass rates" / "students score X higher":** need methodologically sound comparative evidence (a proper control, adequate sample, and the same population the ad implies). Internal A/B tests may qualify if designed rigorously. Self-selected testimonials don't.
  - **"No hallucination":** almost certainly unsubstantiable for an LLM product. The Workado "98% accurate" case shows accuracy claims are a live target. Use "answers are grounded in your course materials and cite sources; always verify."
  - **"Unlimited":** must be true. Any fair-use caps, rate limits or model downgrades must be disclosed clearly and close to the claim.
- **Reviews and testimonials, 16 CFR Part 465** (in force since October 21, 2024) [STATUTE/RULE]:
  - bans fake and AI-generated reviews;
  - bans incentives conditioned on positive sentiment;
  - bans undisclosed insider reviews;
  - bans suppressing negative reviews.
  - In a December 22, 2025 press release, the FTC said it had warned 10 companies about possible violations of the Consumer Review Rule, citing "civil penalties of up to $53,088 per violation." Endorsement Guides (16 CFR Part 255) govern ambassador and influencer disclosures.
- **Free trial and subscription (7-day trial, $9.99/month, $29/semester):**
  - The federal click-to-cancel rule was vacated, and the FTC opened a new ANPRM in March 2026.
  - ROSCA still requires clear disclosure of material terms before billing, express informed consent, and simple cancellation [STATUTE].
  - State auto-renewal laws (e.g., California's) add renewal reminders and online cancellation [STATUTE; specific state texts not fetched in this research ⚖️ LAWYER].

**Should do**
- Build a "claims file" for every outcome or AI claim (methodology, data, date, reviewer).
- Re-test claims after model changes.
- Use Stripe-native trial reminders and a one-click cancel even where not strictly required.

**Avoid**
- Earnings or grade guarantees; superlatives ("#1," "best") without data.
- Testimonials from employees or friends without disclosure.
- Using cross-student aggregates in ads unless they meet the de-identification standard above.

## Consent Wording Examples (drafts for counsel review)

**A. Canvas connection consent**
> **Connect Canvas (read-only).** You're giving Cordia a personal access token so we can read your courses, assignments, due dates, exam dates and announcements from Canvas. We only read; we never submit, post or change anything. Your token is encrypted. Your school has not partnered with Cordia, and this connection is your choice. Some schools restrict tokens, so check your school's IT policy. You can disconnect anytime in Settings → Connections, and we'll delete synced Canvas data within [X] days.
> ☐ Sync course content and dates  ☐ Also sync my grades (optional)

**B. Linking grades to study behavior**
> **Learn what works for you (optional).** With your permission, Cordia will compare how you studied (formats, accuracy, confidence, time spent) with the grades you got in Canvas, so we can adjust your plans. This creates a personal learning profile. We don't share it with your school, instructors or classmates, we don't use it for advertising, and we never sell it. Turn it off anytime; you can also delete your profile.
> ☐ Yes, use my grades to personalize my study plans

**C. Sensitive questionnaire opt-in (test anxiety / personality)**
> **Optional: how you feel about tests.** These questions ask about stress and anxiety around exams. Your answers may be considered health-related information in some states. They're optional, skipping them won't limit any feature, and they are not a diagnosis. We use them only to shape your study plan, store them separately, and never sell or share them for advertising. [Link: Consumer Health Data Privacy Policy]
> ☐ I agree to Cordia collecting and using my answers for this purpose
> *(If you're struggling, call or text 988.)*

**D. SMS opt-in, adults (18+)**
> **Cordia Assistant texts.** By checking this box, you agree to receive recurring automated text messages from Cordia Classroom at [number] for study reminders, daily plans, check-ins and exam alerts. Frequency varies (up to [N]/day). Msg & data rates may apply. Consent is not a condition of purchase. Reply STOP to cancel, HELP for help. Texts are sent 8 a.m.–8 p.m. your local time. [Terms] [Privacy]
> ☐ I'm 18 or older and agree

Confirmation text: "Cordia Assistant: You're signed up for study reminders (up to [N] msgs/day). Msg&data rates may apply. Reply HELP for help, STOP to cancel."

**E. SMS opt-in, minors (13–17) via parent/guardian** ⚖️ LAWYER
> **Parent/guardian consent for texts.** I am the parent or legal guardian of [student name], who is under 18. I agree that Cordia Classroom may send recurring automated study-reminder texts to [student's number]. These are informational only; no promotions will be sent. Up to [N] msgs/day, 8 a.m.–8 p.m. local time. Msg & data rates may apply. My student or I can reply STOP at any time. I can withdraw consent at [link/email].
> ☐ I confirm I'm the parent/guardian and agree  [verification step]

**F. Aggregated / de-identified data notice (privacy policy)**
> **De-identified data.** We combine learning data across many students to improve default study settings and to describe how Cordia is used. Before we do, we remove or transform information so it cannot reasonably be linked to you. We don't publish any statistic based on fewer than 10 students. We publicly commit to keep this data in de-identified form and not to attempt to re-identify it, and we contractually require anyone who receives it to do the same. We do not allow our AI providers to train their models on your data.

**G. Trademark disclaimer (footer on every page using the marks)**
> NCLEX®, NCLEX-RN® and NCLEX-PN® are registered trademarks of the National Council of State Boards of Nursing, Inc. LSAT® is a trademark registered by LSAC. MCAT® is a registered trademark of the Association of American Medical Colleges. SAT® is a trademark registered by the College Board. [ACT®, GRE®, TOEFL®, CPA Exam, MBE®/UBE® owners listed similarly.] None of these organizations is affiliated with, sponsors, or endorses Cordia Classroom. Cordia's practice questions are original and are not actual exam questions.

## Caveats

- **Primary and secondary sourcing:** several items rely on law-firm summaries rather than primary text. These include the Colorado SB 26-189 replacement, the FCC revocation-waiver extension and FCC 26-67, the Oklahoma statute, and CCPA §1798.120(c). Statuses for the minors' design-code laws, KOSA and COPPA 2.0, ACT/ETS/AICPA trademark guidelines, Nevada and Colorado sensitive-data definitions, HIPAA de-identification text, and the HBNR were not verified in this research.
- **Old but still authoritative:** the PTAC FAQ (2012/2013) and NCES Brief 3 (2010) remain the main ED references on cell size. The trademark-enforcement precedents (College Board 2008, ETS/Kaplan 1990s) are old. LSAC's 2025 complaint shows enforcement is ongoing.
- **Positions of trademark owners, not law:** statements such as LSAC's claim that ads for tutoring are not fair use, or NCBE's demand for written consent for any mark use, are owners' positions. Courts apply nominative fair use more permissively in some circuits.
- **Common beliefs not supported:**
  - "FERPA always applies to edtech": it doesn't for a student-initiated consumer app.
  - "Small startups are exempt from privacy laws": MHMDA has no threshold, and Connecticut has none for sensitive data.
  - "Anonymized data is always safe": CCPA requires process commitments, and small cells re-identify.
  - "The click-to-cancel rule means we must…": it was vacated, though ROSCA remains.
  - "A disclaimer cures any trademark use": it doesn't cure using real questions, logos, or marks in product names.

## Questions to Take to a Lawyer

1. When a student connects Canvas with their own personal access token, does any FERPA obligation attach to Cordia? Does a school's Canvas acceptable-use policy create contract or computer-access exposure for Cordia or the student?
2. If an instructor (not the institution) "partners" with Cordia or recommends it to a class, does that make Cordia a school official? What contract terms do we need before any school or instructor deal (AB 1584, NY Ed Law 2-d, Colorado, Illinois SOPPA for K-12)?
3. Do test-anxiety or stress items, or inferences from confidence and latency data, count as "consumer health data" under Washington MHMDA, Nevada and Connecticut? Do Mini-IPIP/IPIP-50 personality scores count as sensitive data anywhere?
4. Which state comprehensive privacy laws do we meet the thresholds for today, and at what user counts do Connecticut (35,000), Colorado, Virginia, Oregon and California kick in? Is Texas's small-business exemption available to us?
5. Is our adaptive engine or study plan an ADMT "significant decision" under the CPPA rules, or a consequential-decision system under Colorado SB 26-189 (effective January 1, 2027)? Do we need a CCPA risk assessment or a Connecticut profiling impact assessment?
6. Are internal A/B tests with a control group okay as designed? Would publishing results or partnering with a university require IRB review?
7. For ACT/SAT: will marketing to high-school students, parents or counselors make us a SOPIPA/SOPPA/Ed Law 2-d "operator"? How should we design age gating to avoid COPPA "actual knowledge," and what does the April 22, 2026 amended rule require if we allow under-13s?
8. Which minors' laws apply to a 13–17 study app: NY Child Data Protection Act, Maryland Kids Code, California AADC, Texas SCOPE, Connecticut's engagement-feature ban (do streaks and SMS check-ins violate it?), Colorado's minors' amendments, and any federal KOSA/COPPA 2.0 if enacted?
9. For texting 13–17-year-olds: is parental consent required or sufficient under the TCPA, and how should we verify it? What is the current status of the FCC "revoke-all" waiver and FCC 26-67? Do any state laws (Florida, Oklahoma, others) reach our informational texts? Does any "upgrade" or trial text make messages promotional?
10. Is our de-identification approach (n ≥ 10, public commitment, contractual controls) enough under CCPA, Connecticut and MHMDA, both for improving defaults and for marketing statistics? Do our Anthropic, Composio and Supabase contracts prohibit training and secondary use?
11. Can we use NCLEX, LSAT, MCAT, SAT, ACT, MBE/UBE, GRE/TOEFL and CPA Exam in product names, page titles, app-store listings and paid-search ads? Should we seek licenses (e.g., LSAC Official LSAT content licensing, the NCSBN sample pack)?
12. How do we keep AI-generated practice items from reproducing copyrighted or secure exam content, and what review process would show diligence?
13. What evidence would substantiate "proven," "boosts pass rates" or "students score X higher"? Can we say "unlimited" with fair-use caps? What should replace "no hallucination"?
14. Does our 7-day free trial, monthly plan and semester plan flow comply with ROSCA and the state auto-renewal laws where our users live (renewal reminders, online cancellation, semester-plan auto-renewal disclosure)?
15. What is our breach-notification and incident-response exposure if encrypted Canvas tokens or learner profiles leak? Does the FTC Health Breach Notification Rule ever reach us?
