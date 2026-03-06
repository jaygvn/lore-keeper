const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function run() {
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });
  const prompt = `You are the Cave Scribe. Respond to: ${process.env.ISSUE_BODY}`;
  const result = await model.generateContent(prompt);
  const response = await result.response.text();
  
  // Post response back to GitHub
  const { Octokit } = require('@octokit/rest');
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  
  await octokit.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: process.env.ISSUE_NUMBER,
    body: response
  });
}

run().catch(console.error);
