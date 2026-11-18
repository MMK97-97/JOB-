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
    let score = 45; // base score for passing negative keyword filters

    // Target title matches
    const targetTitles = this.criteria.targetTitles || [];
    let titleMatched = false;

    for (const t of targetTitles) {
      const tLower = t.toLowerCase().trim();
      if (tLower && (title.includes(tLower) || tLower.includes(title))) {
        score += 35;
        titleMatched = true;
        matchedKeywords.push(`Target Title: ${t}`);
        break;
      }
    }

    // Role word match (any supply chain related domain)
    if (!titleMatched) {
      const coreRoleWords = [
        'supply chain', 'procurement', 'inventory', 'planner', 'planning',
        'purchasing', 'buyer', 'logistics', 'sourcing', 'operations', 'materials',
        'demand', 'inbound', 'fulfillment', 'freight', 'vendor', 'supplier',
        'distribution', 'warehouse', 'reorder', 'scheduler', 's&op',
        'shipping', 'receiving', 'transportation', 'analyst', 'coordinator',
        'specialist', 'manager', 'lead', 'associate', 'clerk', 'dispatcher'
      ];
      for (const rw of coreRoleWords) {
        if (title.includes(rw)) {
          score += 35;
          titleMatched = true;
          matchedKeywords.push(`Supply Chain Role: ${rw}`);
          break;
        }
      }
    }

    // Keyword hits in full card text
    for (const kw of this.coreKeywords) {
      if (fullText.includes(kw)) {
        score += 5;
        matchedKeywords.push(kw);
      }
    }

    // Cap score at 100
    score = Math.min(100, Math.round(score));

    const minScore = Math.min(this.criteria.minimumMatchScore || 30, 35);
    const eligible = score >= minScore;

    return {
      eligible,
      score,
      reason: eligible ? 'Met target criteria' : `Score ${score}% below minimum threshold of ${minScore}%`,
      matchedKeywords
    };
  }
}
