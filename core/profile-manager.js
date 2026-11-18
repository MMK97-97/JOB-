import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ProfileManager {
  constructor(configDir = path.resolve(__dirname, '../config')) {
    this.configDir = configDir;
    this.profilePath = path.join(this.configDir, 'profile.json');
    this.searchCriteriaPath = path.join(this.configDir, 'search-criteria.json');
    this.resumePath = path.resolve(__dirname, '../assets/resume.pdf');
    this.load();
  }

  load() {
    this.profile = JSON.parse(fs.readFileSync(this.profilePath, 'utf8'));
    this.profile.customAnswers = this.profile.customAnswers || {};
    this.searchCriteria = JSON.parse(fs.readFileSync(this.searchCriteriaPath, 'utf8'));
  }

  saveProfile(updatedProfile) {
    this.profile = { ...this.profile, ...updatedProfile };
    fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2), 'utf8');
  }

  normalizeQuestionKey(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  findSavedCustomAnswer(questionText) {
    if (!this.profile.customAnswers) return null;
    const norm = this.normalizeQuestionKey(questionText);
    if (!norm) return null;

    if (this.profile.customAnswers[norm]) {
      return this.profile.customAnswers[norm].answer;
    }
    for (const [key, item] of Object.entries(this.profile.customAnswers)) {
      if (norm.includes(key) || key.includes(norm)) {
        return item.answer;
      }
    }
    return null;
  }

  saveCustomAnswer(questionText, answer, type = 'text') {
    this.profile.customAnswers = this.profile.customAnswers || {};
    const key = this.normalizeQuestionKey(questionText);
    this.profile.customAnswers[key] = {
      prompt: questionText,
      answer: answer,
      type: type,
      savedAt: new Date().toISOString()
    };
    this.saveProfile(this.profile);
    return this.profile.customAnswers[key];
  }

  deleteCustomAnswer(key) {
    if (this.profile.customAnswers && this.profile.customAnswers[key]) {
      delete this.profile.customAnswers[key];
      this.saveProfile(this.profile);
      return true;
    }
    return false;
  }

  isKnownQuestion(questionText, inputType = 'text', options = []) {
    // 1. Check if candidate previously answered & saved it
    if (this.findSavedCustomAnswer(questionText) !== null) {
      return true;
    }

    const q = questionText.toLowerCase().trim();

    // 2. Commute & Relocation
    if (q.includes('commute') || q.includes('reliably commute') || q.includes('travel to') || q.includes('on-site') || q.includes('hybrid') || q.includes('relocate')) {
      return true;
    }

    // 3. Authorization & Legal
    if (
      q.includes('authorized') || q.includes('sponsorship') || q.includes('visa') ||
      q.includes('background check') || q.includes('drug test') || q.includes('driver') ||
      q.includes('18 years') || q.includes('21 years') || q.includes('previously employed') ||
      q.includes('relative') || q.includes('felony') || q.includes('convicted') ||
      q.includes('non-compete') || q.includes('nda') || q.includes('terminated') ||
      q.includes('fired') || q.includes('resigned') || q.includes('accommodation') ||
      q.includes('lift') || q.includes('physical') || q.includes('english') || q.includes('fluent')
    ) {
      return true;
    }

    // 4. EEO & Demographics
    if (
      q.includes('gender') || q.includes('sex') || q.includes('pronoun') ||
      q.includes('race') || q.includes('ethnicity') || q.includes('hispanic') ||
      q.includes('latino') || q.includes('veteran') || q.includes('disability')
    ) {
      return true;
    }

    // 5. Role qualifications & experience
    if (
      q.includes('automotive') || q.includes('auto part') || q.includes('diesel') ||
      q.includes('overtime') || q.includes('show up daily') || q.includes('attendance') ||
      q.includes('essential to the success') || q.includes('highest level of education') ||
      q.includes('degree') || q.includes('years of experience') || q.includes('how many years') ||
      q.includes('years experience') || q.includes('number of years') || q.includes('how many') ||
      q.includes('bilingual') || q.includes('spanish') || q.includes('espanol') ||
      q.includes('fishbowl') || q.includes('traceability') ||
      q.includes('salary') || q.includes('compensation') || q.includes('pay') ||
      q.includes('hourly') || q.includes('rate') || q.includes('notice') ||
      q.includes('start date') || q.includes('availability') || q.includes('cover letter') ||
      q.includes('statement') || q.includes('s&op') || q.includes('six sigma') ||
      q.includes('apics') || q.includes('cscp') || q.includes('erp') || q.includes('sap') ||
      q.includes('excel') || q.includes('sql') || q.includes('power bi') || q.includes('gpa')
    ) {
      return true;
    }

    return false;
  }

  saveSearchCriteria(updatedCriteria) {
    this.searchCriteria = { ...this.searchCriteria, ...updatedCriteria };
    fs.writeFileSync(this.searchCriteriaPath, JSON.stringify(this.searchCriteria, null, 2), 'utf8');
  }

  getResumePath() {
    if (fs.existsSync(this.resumePath)) {
      return this.resumePath;
    }
    // Fallback search in user Downloads
    const downloadsFallback = 'C:\\Users\\Manne\\Downloads\\Manoj_Kumar_Manne_Amazon_R2L_Supply_Chain_Manager_II_ATS_Resume.pdf';
    if (fs.existsSync(downloadsFallback)) {
      return downloadsFallback;
    }
    return null;
  }

  /**
   * Intelligently answers a question given prompt text and question type
   */
  answerQuestion(questionText, inputType = 'text', options = []) {
    // 0. Priority: Check if candidate previously answered & saved this exact or similar question
    const savedCustom = this.findSavedCustomAnswer(questionText);
    if (savedCustom !== null) {
      if (options && options.length > 0) {
        const match = options.find(o =>
          o.toLowerCase() === savedCustom.toLowerCase() ||
          o.toLowerCase().startsWith(savedCustom.toLowerCase()) ||
          o.toLowerCase().includes(savedCustom.toLowerCase())
        );
        if (match) return match;
      }
      return savedCustom;
    }

    const q = questionText.toLowerCase().trim();

    // Commute: Always prioritize affirmative commute readiness across all location variations
    if (
      q.includes('commute') ||
      q.includes('reliably commute') ||
      q.includes('commute to') ||
      q.includes('travel to') ||
      q.includes('on-site') ||
      q.includes('hybrid') ||
      q.includes('in-person') ||
      q.includes('transportation')
    ) {
      const commuteAns = this.profile.screeningAnswers?.commute_ok || 'Yes';
      if (options.length > 0) {
        const match = options.find(o =>
          o.toLowerCase() === commuteAns.toLowerCase() ||
          o.toLowerCase().startsWith(commuteAns.toLowerCase())
        );
        if (match) return match;
      }
      return commuteAns;
    }

    // 1. Experience Years / Numeric Questions (Always returns a clean integer, NEVER sentences)
    if (
      q.includes('how many years') ||
      q.includes('years of experience') ||
      q.includes('years experience') ||
      q.includes('number of years') ||
      q.includes('how many') ||
      inputType === 'number'
    ) {
      let matchedYears = null;
      for (const [skill, years] of Object.entries(this.profile.skillsYearsOfExperience || {})) {
        if (q.includes(skill.toLowerCase())) {
          matchedYears = years;
          break;
        }
      }
      if (matchedYears === null) {
        matchedYears = this.profile.screeningAnswers?.default_experience_years || 5;
      }

      if (options && options.length > 0) {
        const matchOpt = options.find(o =>
          o.includes(matchedYears.toString()) ||
          (matchedYears >= 5 && (o.includes('5+') || o.includes('5 or more') || o.includes('5-'))) ||
          (matchedYears >= 3 && (o.includes('3+') || o.includes('3-5')))
        );
        if (matchOpt) return matchOpt;
      }

      return matchedYears.toString();
    }

    // 2. Bilingual / Foreign Language Questions (Manoj is fluent in English, Hindi, Telugu; not Spanish)
    if (q.includes('bilingual') || q.includes('spanish') || q.includes('espanol')) {
      const spanishAns = this.profile.screeningAnswers?.bilingual_spanish || 'No';
      if (options && options.length > 0) {
        const match = options.find(o => o.toLowerCase() === spanishAns.toLowerCase() || o.toLowerCase().startsWith('no'));
        if (match) return match;
      }
      return spanishAns;
    }

    // 1. Authorization, Legal & Company Policy
    if (q.includes('legally authorized') || q.includes('authorized to work') || q.includes('eligible to work')) {
      return this.profile.workAuthorization.legallyAuthorizedInUS ? 'Yes' : 'No';
    }

    if (q.includes('sponsorship') || q.includes('require visa') || q.includes('now or in the future require')) {
      return this.profile.workAuthorization.requireSponsorship ? 'Yes' : 'No';
    }

    if (q.includes('previously employed') || q.includes('worked for this company') || q.includes('worked here before')) {
      return 'No';
    }

    if (q.includes('relative') || q.includes('family member') || q.includes('conflict of interest')) {
      return 'No';
    }

    if (q.includes('non-compete') || q.includes('restrictive covenant') || q.includes('agreement with another employer') || q.includes('nda')) {
      return 'No';
    }

    if (q.includes('terminated') || q.includes('fired') || q.includes('asked to resign') || q.includes('involuntary separation')) {
      return 'No';
    }

    if (q.includes('accommodation') || q.includes('require accommodation') || q.includes('need accommodations')) {
      return 'No';
    }

    if (q.includes('lift') || q.includes('50 lbs') || q.includes('25 lbs') || q.includes('physical demand') || q.includes('stand or walk')) {
      return 'Yes';
    }

    if (q.includes('english') || q.includes('fluent in') || q.includes('read and write english') || q.includes('speak english')) {
      return 'Yes';
    }

    if (q.includes('gpa') || q.includes('cumulative gpa')) {
      return '3.8';
    }

    if (q.includes('18 years') || q.includes('at least 18') || q.includes('21 years') || q.includes('age')) {
      return 'Yes';
    }

    if (q.includes('background check') || q.includes('criminal background')) {
      return this.profile.workAuthorization.passBackgroundCheck ? 'Yes' : 'No';
    }

    if (q.includes('drug screen') || q.includes('drug test')) {
      return this.profile.workAuthorization.passDrugScreen ? 'Yes' : 'No';
    }

    if (q.includes('driver\'s license') || q.includes('drivers license') || q.includes('driver license')) {
      return this.profile.workAuthorization.hasDriversLicense ? 'Yes' : 'No';
    }

    if (q.includes('relocate') || q.includes('willing to relocate')) {
      const relocateAns = this.profile.screeningAnswers?.relocate || (this.profile.workAuthorization.willingToRelocate ? 'Yes' : 'No');
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase().includes(relocateAns.toLowerCase()));
        if (match) return match;
      }
      return relocateAns;
    }

    if (q.includes('commute') || q.includes('travel to') || q.includes('on-site') || q.includes('hybrid') || q.includes('remote')) {
      const commuteAns = this.profile.screeningAnswers?.commute_ok || 'Yes';
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase().includes(commuteAns.toLowerCase()));
        if (match) return match;
      }
      return commuteAns;
    }

    // Role specific custom screening questions
    if (q.includes('automotive') || q.includes('auto part') || q.includes('diesel')) {
      const autoAns = this.profile.screeningAnswers?.automotive_parts || 'Yes';
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase().includes(autoAns.toLowerCase()) || (autoAns === 'Yes' && o.toLowerCase().includes('direct experience')));
        if (match) return match;
      }
      return autoAns;
    }

    if (q.includes('overtime') || q.includes('show up daily') || q.includes('attendance') || q.includes('essential to the success') || q.includes('weekends') || q.includes('shift') || q.includes('full-time') || q.includes('schedule')) {
      const otAns = this.profile.screeningAnswers?.overtime_daily || 'Yes';
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase().includes(otAns.toLowerCase()) || (otAns === 'Yes' && o.toLowerCase().includes('committed')));
        if (match) return match;
      }
      return otAns;
    }

    // 2. Certifications & Qualifications
    if (q.includes('six sigma') || q.includes('green belt')) {
      if (options.length > 0) {
        const progOpt = options.find(o => o.toLowerCase().includes('progress') || o.toLowerCase().includes('yes'));
        if (progOpt) return progOpt;
      }
      return 'Yes';
    }

    if (q.includes('apics') || q.includes('cscp') || q.includes('ascm')) {
      if (options.length > 0) {
        const progOpt = options.find(o => o.toLowerCase().includes('progress') || o.toLowerCase().includes('yes'));
        if (progOpt) return progOpt;
      }
      return 'Yes';
    }

    // 3. Tool Proficiency Levels (Expert / Advanced / Intermediate)
    if (q.includes('proficiency') || q.includes('skill level') || q.includes('how proficient') || q.includes('how familiar')) {
      if (options.length > 0) {
        const advancedOpt = options.find(o =>
          o.toLowerCase().includes('advanced') ||
          o.toLowerCase().includes('expert') ||
          o.toLowerCase().includes('proficient') ||
          o.toLowerCase().startsWith('5') ||
          o.toLowerCase().startsWith('4')
        );
        if (advancedOpt) return advancedOpt;
      }
      return 'Advanced';
    }

    // 4. Experience Years (Precise matching per skill/tool)
    if (q.includes('how many years') || q.includes('years of experience') || q.includes('years experience') || q.includes('experience do you have with')) {
      for (const [skill, years] of Object.entries(this.profile.skillsYearsOfExperience)) {
        if (q.includes(skill.toLowerCase())) {
          if (options.length > 0) {
            // Find option matching years (e.g. "3-5 years" or "5+ years")
            const matchOpt = options.find(o => o.includes(years.toString()) || o.toLowerCase().includes('5+'));
            if (matchOpt) return matchOpt;
          }
          return years.toString();
        }
      }
      return (this.profile.screeningAnswers.default_experience_years || 5).toString();
    }

    // 5. Compensation
    if (q.includes('desired salary') || q.includes('expected salary') || q.includes('target salary') || q.includes('compensation expectation')) {
      if (q.includes('hour') || q.includes('hourly')) {
        return this.profile.compensation.expectedHourlyRate.toString();
      }
      return this.profile.compensation.expectedSalaryAnnual.toString();
    }

    // 6. Education
    if (q.includes('highest level of education') || q.includes('education level') || q.includes('degree completed')) {
      const targetEdu = this.profile.screeningAnswers?.highest_education || this.profile.education?.highestLevel || "Master's Degree";
      if (options.length > 0) {
        const exact = options.find(o => o.toLowerCase().includes(targetEdu.toLowerCase()));
        if (exact) return exact;
        if (targetEdu.toLowerCase().includes('master')) {
          const masterOpt = options.find(o => o.toLowerCase().includes('master'));
          if (masterOpt) return masterOpt;
        }
        const bachelorsOpt = options.find(o => o.toLowerCase().includes('bachelor'));
        if (bachelorsOpt) return bachelorsOpt;
      }
      return targetEdu;
    }

    // 7. Notice Period / Start Date
    if (q.includes('notice') || q.includes('start date') || q.includes('how soon') || q.includes('availability')) {
      if (inputType === 'number') return '14';
      return this.profile.screeningAnswers?.notice_period || this.profile.compensation?.noticePeriod || '2 weeks';
    }

    // 8. EEO & Demographic questions
    if (q.includes('hispanic') || q.includes('latino')) {
      const hisp = this.profile.eeo?.hispanicLatino || 'No';
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase().includes(hisp.toLowerCase()) || (hisp === 'No' && o.toLowerCase().includes('not hispanic')));
        if (match) return match;
      }
      return hisp;
    }

    if (q.includes('gender') || q.includes('sex')) {
      const gender = this.profile.eeo?.gender || 'Male';
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase() === gender.toLowerCase() || (gender === 'Male' && o.toLowerCase().includes('man')));
        if (match) return match;
      }
      return gender;
    }

    if (q.includes('pronoun')) {
      const pronouns = this.profile.eeo?.pronouns || 'He/Him';
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase().includes(pronouns.toLowerCase()) || o.toLowerCase().replace(/\s+/g, '') === pronouns.toLowerCase().replace(/\s+/g, ''));
        if (match) return match;
      }
      return pronouns;
    }

    if (q.includes('race') || q.includes('ethnicity')) {
      const race = this.profile.eeo?.raceEthnicity || 'Asian';
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase().includes(race.toLowerCase()));
        if (match) return match;
      }
      return race;
    }

    if (q.includes('veteran')) {
      const vet = this.profile.eeo?.veteranStatus || 'I am not a protected veteran';
      if (options.length > 0) {
        const match = options.find(o =>
          o.toLowerCase().includes(vet.toLowerCase()) ||
          o.toLowerCase().includes('not a protected veteran') ||
          o.toLowerCase().includes('not a veteran') ||
          o.toLowerCase().includes('i am not') ||
          (vet === 'No' && o.toLowerCase() === 'no')
        );
        if (match) return match;
      }
      return vet;
    }

    if (q.includes('disability')) {
      const dis = this.profile.eeo?.disabilityStatus || 'No, I do not have a disability';
      if (options.length > 0) {
        const match = options.find(o =>
          o.toLowerCase().includes(dis.toLowerCase()) ||
          o.toLowerCase().includes('no, i do not') ||
          o.toLowerCase().includes('no disability') ||
          o.toLowerCase().includes('not have a disability') ||
          (dis === 'No' && o.toLowerCase() === 'no')
        );
        if (match) return match;
      }
      return dis;
    }

    if (q.includes('lgbt') || q.includes('sexual orientation')) {
      if (options.length > 0) {
        const declineOpt = options.find(o => o.toLowerCase().includes('decline') || o.toLowerCase().includes('prefer not'));
        if (declineOpt) return declineOpt;
      }
      return 'Decline to specify';
    }

    // 7. General Yes/No default heuristic
    if (inputType === 'radio' || (options.length === 2 && options.includes('Yes') && options.includes('No'))) {
      if (q.includes('felony') || q.includes('convicted') || q.includes('terminated') || q.includes('fired')) {
        return 'No';
      }
      return 'Yes';
    }

    // Default numeric answer
    if (inputType === 'number' || q.includes('how many years') || q.includes('years of experience') || q.includes('number of years')) {
      return '5';
    }

    // 8. Final Fallback: Open-ended textarea or tailored statements
    if (inputType === 'textarea' || (inputType === 'text' && (!options || options.length === 0))) {
      if (q.startsWith('are you') || q.startsWith('do you') || q.startsWith('can you') || q.startsWith('will you') || q.startsWith('have you')) {
        if (q.includes('sponsorship') || q.includes('felony') || q.includes('terminated') || q.includes('fired') || q.includes('convicted') || q.includes('bilingual') || q.includes('spanish')) {
          return 'No';
        }
        return 'Yes';
      }
      return this.generateTailoredTextAnswer(questionText);
    }

    return 'Yes';
  }

  generateTailoredTextAnswer(questionText) {
    const q = questionText.toLowerCase().trim();

    // Safeguards: Never generate sentences for numeric or bilingual prompts
    if (q.includes('how many years') || q.includes('years of experience') || q.includes('number of years') || q.includes('how many')) {
      return '5';
    }
    if (q.includes('bilingual') || q.includes('spanish') || q.includes('espanol')) {
      return 'No';
    }

    // 1. Cover letter prompt
    if (q.includes('cover letter') || q.includes('statement of purpose') || q.includes('letter of interest')) {
      return this.profile.coverLetter;
    }

    // 2. Automotive / Mechanical / Parts / Equipment / BOMs
    if (
      q.includes('automotive') ||
      q.includes('auto part') ||
      q.includes('mechanical') ||
      q.includes('parts') ||
      q.includes('bom') ||
      q.includes('machinery') ||
      q.includes('equipment') ||
      q.includes('vehicle') ||
      q.includes('diesel')
    ) {
      const autoSaved = this.profile.screeningAnswers?.automotive_parts || 'Yes';
      if (autoSaved.toLowerCase().startsWith('no')) {
        return 'While my core focus has been overall mechanical equipment and technical inventory planning, I bring deep experience managing 900+ technical SKUs and BOMs with strong mechanical engineering foundations.';
      }
      return 'Yes, I have direct experience working with automotive and mechanical parts, backed by my B.Tech in Mechanical Engineering. In my supply chain and procurement roles, I have managed cataloging, inventory forecasting, and vendor sourcing for 900+ technical SKUs, maintaining bills of materials (BOMs) and tracking inventory replenishment.';
    }

    // 3. Attendance / Overtime / Essential to success / Daily attendance / Shifts
    if (
      q.includes('show up daily') ||
      q.includes('daily') ||
      q.includes('overtime') ||
      q.includes('attendance') ||
      q.includes('punctual') ||
      q.includes('shift') ||
      q.includes('essential to the success') ||
      q.includes('weekends') ||
      q.includes('schedule')
    ) {
      const otSaved = this.profile.screeningAnswers?.overtime_daily || 'Yes';
      if (otSaved.toLowerCase().startsWith('no')) {
        return 'I am available for all regular scheduled working shifts.';
      }
      return 'Yes, I am fully committed to showing up daily on time, maintaining 100% reliable attendance, and working overtime, weekend, or flexible shifts as needed to ensure operational success and customer fulfillment.';
    }

    // 4. Why interested / Why hire you / What makes you a good fit / Summary
    if (
      q.includes('why are you interested') ||
      q.includes('why should we hire') ||
      q.includes('why hire you') ||
      q.includes('good fit') ||
      q.includes('tell us about yourself') ||
      q.includes('summary of qualifications') ||
      q.includes('why this role') ||
      q.includes('interest in this position') ||
      q.includes('describe yourself')
    ) {
      return 'With over 5 years of supply chain, procurement, and inventory planning experience, combined with an M.S. in Engineering Management and B.Tech in Mechanical Engineering, I bring proven expertise in optimizing 900+ SKUs, reducing costs by 15%, and maintaining 95% on-time delivery. I combine rigorous analytical capabilities in Excel, SQL, and ERP systems with a proactive approach to drive operational efficiency.';
    }

    // 5. ERP / SAP / Systems / Software
    if (
      q.includes('erp') ||
      q.includes('sap') ||
      q.includes('netsuite') ||
      q.includes('quickbooks') ||
      q.includes('oracle') ||
      q.includes('wms') ||
      q.includes('software')
    ) {
      return 'I have over 5 years of hands-on experience utilizing ERP systems (including SAP, NetSuite, and QuickBooks) to manage inventory levels, create and track purchase orders, maintain BOMs, and monitor supplier performance.';
    }

    // 6. Excel / Reporting / Data Analysis / SQL / Power BI
    if (
      q.includes('excel') ||
      q.includes('spreadsheet') ||
      q.includes('sql') ||
      q.includes('power bi') ||
      q.includes('tableau') ||
      q.includes('data analysis') ||
      q.includes('pivot table') ||
      q.includes('vlookup') ||
      q.includes('analytics')
    ) {
      return 'I possess advanced expertise in Microsoft Excel (including complex PivotTables, Power Query, VLOOKUP, INDEX/MATCH, and forecasting models) as well as SQL and Power BI to extract operational insights and automate reorder analytics.';
    }

    // 7. Inventory Management / Demand Planning / Forecasting / Cycle Counts
    if (
      q.includes('inventory') ||
      q.includes('demand planning') ||
      q.includes('forecasting') ||
      q.includes('cycle count') ||
      q.includes('safety stock') ||
      q.includes('reorder') ||
      q.includes('stockout') ||
      q.includes('shrinkage')
    ) {
      return 'I have 5 years of experience leading inventory management and demand planning, managing $1M+ inventory across 900+ SKUs, calculating safety stock, leading regular cycle counts, and minimizing stockout risk.';
    }

    // 8. Procurement / Purchasing / Sourcing / Vendor Negotiations
    if (
      q.includes('procurement') ||
      q.includes('purchasing') ||
      q.includes('sourcing') ||
      q.includes('vendor') ||
      q.includes('supplier') ||
      q.includes('negotiat') ||
      q.includes('purchase order') ||
      q.includes(' po ')
    ) {
      return 'I have 5 years of procurement experience managing relationships with 80+ suppliers, issuing and auditing purchase orders, and negotiating competitive pricing to achieve 15% cost reductions while maintaining high fulfillment standards.';
    }

    // 9. Logistics / Warehouse / Shipping / Receiving / Distribution / 3PL
    if (
      q.includes('logistics') ||
      q.includes('warehouse') ||
      q.includes('shipping') ||
      q.includes('receiving') ||
      q.includes('distribution') ||
      q.includes('3pl') ||
      q.includes('freight') ||
      q.includes('inbound') ||
      q.includes('outbound')
    ) {
      return 'I have extensive experience managing inbound and outbound logistics, coordinating freight shipments, supervising receiving and staging workflows, and liaising with 3PL partners to ensure seamless dock-to-stock turnaround.';
    }

    // 10. Commute / Relocation
    if (q.includes('commute') || q.includes('relocate') || q.includes('travel') || q.includes('distance') || q.includes('on-site')) {
      return 'Yes, I am fully prepared to commute daily or relocate immediately for this position.';
    }

    // 11. Driver's License / Transportation
    if (q.includes('driver') || q.includes('license') || q.includes('transportation') || q.includes('vehicle')) {
      return 'Yes, I possess a valid driver\'s license and reliable personal transportation.';
    }

    // 12. Background Check / Drug Screen
    if (q.includes('background check') || q.includes('drug screen') || q.includes('drug test')) {
      return 'Yes, I am fully willing and able to pass a background check and drug screen.';
    }

    // 13. Work Authorization / Sponsorship
    if (q.includes('sponsorship') || q.includes('visa')) {
      return 'No, I do not require sponsorship now or in the future.';
    }
    if (q.includes('authorized') || q.includes('legally')) {
      return 'Yes, I am legally authorized to work in the United States.';
    }

    // 14. Salary / Pay / Hourly
    if (q.includes('salary') || q.includes('compensation') || q.includes('pay') || q.includes('rate') || q.includes('hourly')) {
      if (q.includes('hour') || q.includes('hourly')) return '$45 - $48 / hour';
      return '$90,000 - $95,000 / year (negotiable based on total benefits)';
    }

    // 15. Default open-ended response
    return 'Yes, based on my 5+ years of experience in supply chain, procurement, and inventory operations, along with my technical background in engineering management, I have direct experience handling these responsibilities and am committed to delivering high accuracy, strong vendor collaboration, and dependable performance.';
  }
}
