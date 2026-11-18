export class JobMatcher {
  constructor(profile, criteria) {
    this.profile = profile;
    this.criteria = criteria;

    this.coreKeywords = [
      'supply chain', 'demand planning', 'inventory planning', 'inventory analyst',
      'procurement', 'purchasing', 'logistics', 's&op', 'reorder', 'inbound',
      'forecast', 'vendor management', 'supplier', 'erp', 'sap', 'excel',
      'sql', 'power bi', 'tableau', '3pl', 'sku'
    ];
  }

  evaluate(job) {
    const title = (job.title || '').toLowerCase();
    const description = (job.description || '').toLowerCase();
    const company = (job.company || '').toLowerCase();
    const fullText = `${title} ${description} ${company}`;

    // 1. Check blacklist companies
    for (const blacklisted of (this.criteria.blacklistCompanies || [])) {
      if (company.includes(blacklisted.toLowerCase())) {
        return {
          eligible: false,
          score: 0,
          reason: `Company '${job.company}' is in blacklist`
        };
      }
    }

    // 2. Check negative keywords
    for (const neg of (this.criteria.negativeKeywords || [])) {
      if (title.includes(neg.toLowerCase()) || description.includes(neg.toLowerCase())) {
        return {
          eligible: false,
          score: 0,
          reason: `Matched negative keyword '${neg}'`
        };
      }
    }

    // 3. Match calculation
    let matchedKeywords = [];
    let score = 30; // base score for getting past negative filters

    // Title relevancy bonus
    const targetTitles = this.criteria.targetTitles || [];
    const hasTargetTitle = targetTitles.some(t => title.includes(t.toLowerCase()) || t.toLowerCase().includes(title));
    if (hasTargetTitle) {
      score += 30;
      matchedKeywords.push('Target Title Match');
    }

    // Keyword hits in description or title
    for (const kw of this.coreKeywords) {
      if (fullText.includes(kw)) {
        score += 3;
        matchedKeywords.push(kw);
      }
    }

    // Cap score at 100
    score = Math.min(100, Math.round(score));

    const minScore = this.criteria.minimumMatchScore || 50;
    const eligible = score >= minScore;

    return {
      eligible,
      score,
      reason: eligible ? 'Met target criteria' : `Score ${score}% below minimum threshold of ${minScore}%`,
      matchedKeywords
    };
  }
}
