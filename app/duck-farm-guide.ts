const beginning = { title: "USDA beginning farmer guide", url: "https://www.farmers.gov/your-business/beginning-farmers" };
const planning = { title: "USDA farm planning guide", url: "https://www.farmers.gov/your-business/beginning-farmers/business-plan" };

export function farmGuide(question: string, context: string, fallback = false) {
  const greeting = /^\s*(?:hello|hi|hey|good (?:morning|afternoon|evening))(?:[ ,!]+duck)?(?:[ ,.!]+(?:how can you help|what can you do))?[.!?\s]*$/i;
  if (greeting.test(question)) {
    return { answer: "Hi, I’m Duck. I can help you start a farm, choose what to grow, or understand the soil and weather around a field. Are you looking for land, or do you already have a place to grow?" };
  }
  const start = /\b(?:start(?:ing)? (?:a )?farm\b|new to (?:farming|growing crops)|beginner|begin(?:ning)? (?:to )?farm|(?:get|getting) into farming|learn (?:how )?to farm|how (?:do|can|should) i farm|never farmed|first (?:farm|growing season))\b/i.test(question);
  if (start) return {
    answer: "Start with a small first season. Decide whether you’re growing for your household or selling, then check your land access, reliable water, drainage, and soil test. Choose a few crops that fit your growing season and track what you spend, harvest, and sell.\n\nIf you already have land, tell me what you know about it. If you’re still looking, what region and type of farming are you considering?",
    sources: [beginning, planning],
  };
  if (/\b(?:buy|lease|rent|find|choose|looking for|evaluat\w*)\b.*\b(?:land|farmland|a farm|a plot)\b/i.test(question)) return {
    answer: "Before committing to land, check water availability, access, drainage after rain, and recent land use. Walk the site and take soil samples from areas that look or drain differently. If you plan to sell, factor in travel to buyers and the costs of bringing the land into production. What are you hoping to grow, and where are you looking?",
    sources: [{ title: "USDA guide to finding farmland", url: "https://www.farmers.gov/your-business/beginning-farmers/funding" }],
  };
  if (/\b(?:how much|when should i|how often|how do i)\b.*\b(?:water|irrigat\w*)\b/i.test(question)) return {
    answer: "Check moisture at the depth where the crop is rooting and account for recent rain before watering. Sandy soil usually dries faster than heavier soil. Check again after irrigation to see how far the water reached. What crop are you growing, how are you watering it, and what have you noticed in the soil?",
  };
  if (!context && /\b(?:what (?:can|should|could) i (?:plant|grow)|good crops? (?:for|to)|where do i start)\b/i.test(question)) return {
    answer: "Start by matching the crop to your growing season, available water, and drainage. For a first season, choose a few crops you can use or sell and trial them in a small area. If you tell me where you are and whether you can irrigate, I can help narrow the choices.",
    sources: [beginning],
  };
  if (fallback && context && /\b(?:farm\w*|plant\w*|grow\w*|crop\w*|land|soil|water|suggest\w*|recommend\w*|next)\b/i.test(question)) {
    const considerations = [
      /\b(?:no irrigation|rainfed|rain-fed|only rain)\b/i.test(context) &&
        "Since you’re relying on rain, compare planting dates against the onset of reliable rainfall and keep the first planting small.",
      /\b(?:sandy|sand)\b/i.test(context) &&
        "With sandy soil, check how quickly the root zone dries after rain or irrigation before expanding the planting.",
      /\b(?:drip irrigation|drip lines?)\b/i.test(context) &&
        "With drip irrigation, check how far water spreads from an emitter and sample both under the line and between rows.",
    ].filter(Boolean);
    return {
      answer: [considerations.join(" ") || "Check water availability and drainage first, then compare candidate crops against local planting dates and the length of the growing season.",
        "What decision should we work through first: choosing a crop, setting a planting date, or assessing the field?"].join("\n\n"),
      sources: [planning],
    };
  }
  return null;
}
