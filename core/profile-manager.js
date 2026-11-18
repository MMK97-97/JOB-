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
    this.searchCriteria = JSON.parse(fs.readFileSync(this.searchCriteriaPath, 'utf8'));
  }

  saveProfile(updatedProfile) {
    this.profile = { ...this.profile, ...updatedProfile };
    fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2), 'utf8');
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
    const q = questionText.toLowerCase().trim();

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

    if (q.includes('non-compete') || q.includes('restrictive covenant') || q.includes('agreement with another employer')) {
      return 'No';
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
      return this.profile.workAuthorization.willingToRelocate ? 'Yes' : 'No';
    }

    if (q.includes('commute') || q.includes('travel to') || q.includes('on-site') || q.includes('hybrid') || q.includes('remote')) {
      return 'Yes';
    }

    if (q.includes('overtime') || q.includes('weekends') || q.includes('shift') || q.includes('full-time') || q.includes('schedule')) {
      return 'Yes';
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
      if (options.length > 0) {
        const masterOpt = options.find(o => o.toLowerCase().includes('master'));
        if (masterOpt) return masterOpt;
        const bachelorsOpt = options.find(o => o.toLowerCase().includes('bachelor'));
        if (bachelorsOpt) return bachelorsOpt;
      }
      return this.profile.education.highestLevel;
    }

    // 7. Notice Period / Start Date
    if (q.includes('notice') || q.includes('start date') || q.includes('how soon') || q.includes('availability')) {
      if (inputType === 'number') return '14';
      return '2 weeks';
    }

    // 6. EEO & Demographic questions
    if (q.includes('hispanic') || q.includes('latino')) {
      if (options.length > 0) {
        const noOpt = options.find(o => o.toLowerCase().startsWith('no') || o.toLowerCase().includes('not hispanic'));
        if (noOpt) return noOpt;
      }
      return 'No';
    }

    if (q.includes('gender') || q.includes('sex')) {
      if (options.length > 0) {
        const maleOpt = options.find(o => o.toLowerCase() === 'male' || o.toLowerCase().includes('man'));
        if (maleOpt) return maleOpt;
      }
      return this.profile.eeo.gender;
    }

    if (q.includes('pronoun')) {
      if (options.length > 0) {
        const heOpt = options.find(o => o.toLowerCase().includes('he/him') || o.toLowerCase().includes('he / him'));
        if (heOpt) return heOpt;
      }
      return this.profile.eeo.pronouns || 'He/Him';
    }

    if (q.includes('race') || q.includes('ethnicity')) {
      if (options.length > 0) {
        const asianOpt = options.find(o => o.toLowerCase().includes('asian'));
        if (asianOpt) return asianOpt;
      }
      return this.profile.eeo.raceEthnicity;
    }

    if (q.includes('veteran')) {
      if (options.length > 0) {
        const notVet = options.find(o =>
          o.toLowerCase().includes('not a protected veteran') ||
          o.toLowerCase().includes('not a veteran') ||
          o.toLowerCase().includes('i am not') ||
          o.toLowerCase() === 'no'
        );
        if (notVet) return notVet;
      }
      return this.profile.eeo.veteranStatus;
    }

    if (q.includes('disability')) {
      if (options.length > 0) {
        const noDis = options.find(o =>
          o.toLowerCase().includes('no, i do not') ||
          o.toLowerCase().includes('no disability') ||
          o.toLowerCase().includes('not have a disability') ||
          o.toLowerCase() === 'no'
        );
        if (noDis) return noDis;
      }
      return this.profile.eeo.disabilityStatus;
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
    if (inputType === 'number') {
      return '5';
    }

    return 'Yes';
  }
}
