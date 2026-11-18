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

    // 1. Authorization & Legal
    if (q.includes('legally authorized') || q.includes('authorized to work') || q.includes('eligible to work')) {
      return this.profile.workAuthorization.legallyAuthorizedInUS ? 'Yes' : 'No';
    }

    if (q.includes('sponsorship') || q.includes('require visa') || q.includes('now or in the future require')) {
      return this.profile.workAuthorization.requireSponsorship ? 'Yes' : 'No';
    }

    if (q.includes('18 years') || q.includes('at least 18') || q.includes('age')) {
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

    if (q.includes('commute') || q.includes('travel to')) {
      return 'Yes';
    }

    // 2. Experience Years (e.g. "How many years of work experience do you have with Excel?")
    if (q.includes('how many years') || q.includes('years of experience') || q.includes('years experience')) {
      for (const [skill, years] of Object.entries(this.profile.skillsYearsOfExperience)) {
        if (q.includes(skill.toLowerCase())) {
          return years.toString();
        }
      }
      return (this.profile.screeningAnswers.default_experience_years || 5).toString();
    }

    // 3. Compensation
    if (q.includes('desired salary') || q.includes('expected salary') || q.includes('target salary') || q.includes('compensation expectation')) {
      if (q.includes('hour') || q.includes('hourly')) {
        return this.profile.compensation.expectedHourlyRate.toString();
      }
      return this.profile.compensation.expectedSalaryAnnual.toString();
    }

    // 4. Education
    if (q.includes('highest level of education') || q.includes('education level') || q.includes('degree completed')) {
      if (options.length > 0) {
        const masterOpt = options.find(o => o.toLowerCase().includes('master'));
        if (masterOpt) return masterOpt;
        const bachelorsOpt = options.find(o => o.toLowerCase().includes('bachelor'));
        if (bachelorsOpt) return bachelorsOpt;
      }
      return this.profile.education.highestLevel;
    }

    // 5. Notice Period / Start Date
    if (q.includes('notice') || q.includes('start date') || q.includes('how soon') || q.includes('availability')) {
      if (inputType === 'number') return '14';
      return '2 weeks';
    }

    // 6. EEO & Diversity questions
    if (q.includes('gender')) {
      return this.profile.eeo.gender;
    }
    if (q.includes('race') || q.includes('ethnicity')) {
      return this.profile.eeo.raceEthnicity;
    }
    if (q.includes('veteran')) {
      return this.profile.eeo.veteranStatus;
    }
    if (q.includes('disability')) {
      return this.profile.eeo.disabilityStatus;
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
