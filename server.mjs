import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
const root=path.dirname(fileURLToPath(import.meta.url));
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp"};
const quizSessions=new Map();
async function loadEnv(){try{const s=await readFile(path.join(root,".env"),"utf8");for(const line of s.split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^([\"'])(.*)\1$/,"$2")}}catch{}}
function json(res,code,data){res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data))}
async function body(req,limit=22*1024*1024){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>limit)throw Error("Request too large. Keep uploads below 14 MB.");chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString("utf8"))}catch{throw Error("Invalid request.")}}
function splitTutorResponse(text){
  const sections={};let current="";
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();
    const heading=line.match(/^(?:#{1,3}\s*)?(?:\*{1,2}\s*)?(SIMPLE EXPLANATION|KEY POINTS|QUIZ QUESTIONS)(?:\*{1,2})?\s*:?\s*(.*)$/i);
    if(heading){current=heading[1].toUpperCase();sections[current]=heading[2]?[heading[2]]:[]}
    else if(current&&line)sections[current].push(line);
  }
  const quizText=(sections["QUIZ QUESTIONS"]||[]).join("\n");
  const parsed=[...quizText.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?(EASY|MEDIUM|HARD)\s*:\s*(.*?)\s*\|\|\s*(?:ANSWER\s*:\s*)?(.+?)\s*$/gim)];
  const quiz=["EASY","MEDIUM","HARD"].map(difficulty=>{
    const item=parsed.find(match=>match[1].toUpperCase()===difficulty);
    return item?{difficulty,question:item[2].trim(),expectedAnswer:item[3].trim()}:null;
  });
  const lessonText=["SIMPLE EXPLANATION","KEY POINTS"].map(name=>{
    const section=sections[name];
    return section?.length?name+":\n"+section.join("\n"):"";
  }).filter(Boolean).join("\n\n");
  const completeLesson=["SIMPLE EXPLANATION","KEY POINTS"].every(name=>(sections[name]||[]).some(line=>line.trim()));
  return{quiz,lessonText,completeLesson};
}
async function analyze(req,res){
  const key=process.env.GOOGLE_API_KEY;
  if(!key)return json(res,503,{error:"Add GOOGLE_API_KEY to .env for live Gemma 4 analysis."});
  let data;
  try{data=await body(req)}catch(e){return json(res,400,{error:e.message})}
  const m=typeof data.assetDataUrl==="string"&&data.assetDataUrl.match(/^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+\/=\r\n]+)$/);
  const fileText=typeof data.fileText==="string"?data.fileText.trim():"";
  if(fileText.length>60000)return json(res,400,{error:"This document contains too much text. Upload a shorter syllabus (under 60,000 characters)."});
  if(!m&&!fileText)return json(res,400,{error:"Upload a PDF, DOCX, TXT, PNG, JPG or WebP file."});
  const model=process.env.GEMMA_MODEL||"gemma-4-26b-a4b-it";
  const prompt="You are SNOR, a patient AI tutor. The user uploaded a syllabus, study document, or image. Help them understand the actual subject matter; do not merely list file metadata, course codes, section labels, or administrative details. When a syllabus is provided, identify its subject and learning goals, then explain the major topics and how they build on one another. Prioritize concepts a learner needs to understand, not a raw transcription of headings. Return only the final learner-facing answer. Never include analysis, planning, checklists, drafts, self-evaluation, or internal reasoning. Use exactly these sections in this order:\nSIMPLE EXPLANATION: Summarize what the subject/course is about in 1–2 plain-language sentences.\nKEY POINTS: Give 3–5 concise, meaningful learning ideas. Explain the central concepts, what the learner should understand, and where useful how topics connect or progress. Avoid isolated codes, raw data, and copied lists of headings.\nQUIZ QUESTIONS: Create exactly three clear questions based on the explanation, key points, and uploaded material. Use exactly one line for each, formatted as EASY: question || ANSWER: short ideal answer, MEDIUM: question || ANSWER: short ideal answer, and HARD: question || ANSWER: short ideal answer. EASY tests basic recall, MEDIUM tests understanding or application, and HARD tests reasoning or connections. Do not put the answer in the question. These answer keys are used privately to grade the learner and must not be displayed before submission.\nUse clear beginner-friendly language. Do not invent syllabus content. If the upload is an image, use only legible evidence and relevant established context. Answer the user's specific question as well as this structure allows. Keep the response under 280 words, with no greeting, code fences, or unrelated details.";
  try{
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:prompt}]},
        contents:[{role:"user",parts:[
          ...(m?[{inline_data:{mime_type:m[1],data:m[2].replace(/\s/g,"")}}]:[]),
          ...(fileText?[{text:"Extracted syllabus text:\n"+fileText}]:[]),
          {text:"Student request: "+String(data.question||"Explain this syllabus and organize its main learning topics.").slice(0,500)}
        ]}],
        generationConfig:{temperature:.25,maxOutputTokens:1500}
      })
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return json(res,r.status,{error:d.error?.message||"Gemma could not analyze this image."});
    const text=d.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
    if(!text)return json(res,502,{error:"Gemma returned an empty response."});
    const parsed=splitTutorResponse(text);
    if(parsed.quiz.some(item=>!item||!item.question||!item.expectedAnswer)||!parsed.completeLesson)return json(res,502,{error:"Gemma could not prepare the three questions and learning guide. Please try again."});
    const now=Date.now();
    for(const [id,session] of quizSessions)if(now-session.createdAt>30*60*1000)quizSessions.delete(id);
    while(quizSessions.size>=100)quizSessions.delete(quizSessions.keys().next().value);
    const quizId=randomUUID();
    quizSessions.set(quizId,{createdAt:now,quiz:parsed.quiz,lessonText:parsed.lessonText});
    json(res,200,{quizId,questions:parsed.quiz.map(({difficulty,question})=>({difficulty,question})),model});
  }catch(e){json(res,502,{error:"Could not reach Gemma: "+e.message})}
}
async function gradeQuiz(req,res){
  const key=process.env.GOOGLE_API_KEY;
  if(!key)return json(res,503,{error:"Add GOOGLE_API_KEY to .env to grade your answers."});
  let data;
  try{data=await body(req,64000)}catch(e){return json(res,400,{error:e.message})}
  if(typeof data.quizId!=="string"||!Array.isArray(data.answers)||data.answers.length!==3)return json(res,400,{error:"Submit all three quiz answers to get your rating."});
  const session=quizSessions.get(data.quizId);
  if(!session)return json(res,410,{error:"This pre-quiz has expired. Generate a new one from your upload."});
  const expected=["EASY","MEDIUM","HARD"];
  const answers=[];
  for(let i=0;i<expected.length;i++){
    const item=data.answers[i];
    const question=session.quiz[i];
    if(!item||item.difficulty!==expected[i]||typeof item.response!=="string")return json(res,400,{error:"Quiz answers are invalid. Please reload the lesson and try again."});
    if(item.response.length>2000)return json(res,400,{error:"Keep each quiz answer under 2,000 characters."});
    answers.push({...question,response:item.response.trim()});
  }
  const model=process.env.GEMMA_MODEL||"gemma-4-26b-a4b-it";
  const prompt="You are SNOR, a supportive tutor grading a learner's three quiz responses. Compare each response with its expected answer; accept correct paraphrases. Weight EASY 20%, MEDIUM 30%, HARD 50%; blank answers earn zero. Do not show calculations or reasoning. Return only a compact JSON object matching this schema: {\"score\":0,\"rating\":\"Getting started\",\"feedback\":\"One encouraging, honest sentence.\",\"improvements\":[\"Specific topic to review\"]}. Score must be a number from 0 to 100 reflecting weighted correctness. Choose a matching rating: Getting started (0–39), Building understanding (40–69), Strong understanding (70–89), Excellent (90–100). Give 1–3 concise improvement areas grounded in errors. If all answers are correct, give a next-step challenge.";
  try{
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({systemInstruction:{parts:[{text:prompt}]},contents:[{role:"user",parts:[{text:JSON.stringify(answers)}]}],generationConfig:{temperature:0,maxOutputTokens:1800,responseMimeType:"application/json"}})
    });
    const result=await r.json().catch(()=>({}));
    if(!r.ok)return json(res,r.status,{error:result.error?.message||"SNOR could not grade this quiz."});
    const text=result.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
    if(!text)return json(res,502,{error:"SNOR returned an empty quiz rating."});
    let grade=null;
    for(let start=0;start<text.length;start++){
      if(text[start]!=="{")continue;
      let depth=0,inString=false,escaped=false;
      for(let end=start;end<text.length;end++){
        const ch=text[end];
        if(inString){if(escaped)escaped=false;else if(ch==="\\")escaped=true;else if(ch==='"')inString=false;continue}
        if(ch==='"'){inString=true;continue}
        if(ch==="{")depth++;
        else if(ch==="}"&&--depth===0){
          try{
            const candidate=JSON.parse(text.slice(start,end+1));
            if(Number.isFinite(Number(candidate.score))&&typeof candidate.rating==="string"&&typeof candidate.feedback==="string"&&Array.isArray(candidate.improvements))grade=candidate;
          }catch{}
          break;
        }
      }
    }
    if(!grade)return json(res,502,{error:"SNOR returned an invalid quiz rating. Please try again."});
    if(!Number.isFinite(Number(grade.score))||typeof grade.rating!=="string"||typeof grade.feedback!=="string"||!Array.isArray(grade.improvements)||!grade.improvements.every(item=>typeof item==="string"))return json(res,502,{error:"SNOR returned an incomplete quiz rating. Please try again."});
    quizSessions.delete(data.quizId);
    json(res,200,{score:Math.max(0,Math.min(100,Math.round(grade.score))),rating:grade.rating.slice(0,80),feedback:grade.feedback.slice(0,500),improvements:grade.improvements.slice(0,3).map(item=>item.slice(0,200)),text:session.lessonText});
  }catch(e){json(res,502,{error:"Could not reach Gemini to grade the quiz: "+e.message})}
}
async function speak(req,res){
  const key=process.env.ELEVENLABS_API_KEY;
  if(!key)return json(res,503,{error:"Add ELEVENLABS_API_KEY to .env to enable generated voiceover."});
  let data;
  try{data=await body(req,64000)}catch(e){return json(res,400,{error:e.message})}
  const text=typeof data.text==="string"?data.text.trim():"";
  if(!text)return json(res,400,{error:"There is no lesson feedback to read aloud."});
  if(text.length>6500)return json(res,400,{error:"Voiceover text is too long. Keep it under 6,500 characters."});
  const voice=process.env.ELEVENLABS_VOICE_ID||"JBFqnCBsd6RMkjVDRZzb";
  const model=process.env.ELEVENLABS_MODEL||"eleven_multilingual_v2";
  try{
    const upstream=await fetch("https://api.elevenlabs.io/v1/text-to-speech/"+encodeURIComponent(voice)+"/stream?output_format=mp3_22050_32",{
      method:"POST",
      headers:{"xi-api-key":key,"Content-Type":"application/json","Accept":"audio/mpeg"},
      body:JSON.stringify({text,model_id:model})
    });
    if(!upstream.ok){
      const detail=await upstream.text();
      return json(res,502,{error:"ElevenLabs voiceover failed ("+upstream.status+"): "+detail.slice(0,350)});
    }
    if(!upstream.body)return json(res,502,{error:"ElevenLabs returned an empty voiceover."});
    res.writeHead(200,{"Content-Type":"audio/mpeg","Cache-Control":"no-store"});
    Readable.fromWeb(upstream.body).pipe(res);
  }catch(error){json(res,502,{error:"Could not reach ElevenLabs: "+error.message})}
}
async function asset(res,url){let p;try{p=decodeURIComponent(url)}catch{return res.writeHead(400).end()}const f=path.resolve(root,p==="/"?"index.html":p.replace(/^\/+/,"")),rel=path.relative(root,f);if(rel.startsWith("..")||path.isAbsolute(rel))return res.writeHead(403).end();try{const s=await stat(f);if(!s.isFile())return res.writeHead(404).end();res.writeHead(200,{"Content-Type":mime[path.extname(f).toLowerCase()]||"application/octet-stream","Cache-Control":"no-cache"});createReadStream(f).pipe(res)}catch{res.writeHead(404).end("Not found")}}
await loadEnv();const port=Number(process.env.PORT||4173);
const host=process.env.HOST||"127.0.0.1";
createServer(async(req,res)=>{const u=new URL(req.url||"/","http://localhost");if(req.method==="GET"&&u.pathname==="/api/status")json(res,200,{gemma:!!process.env.GOOGLE_API_KEY,elevenLabs:!!process.env.ELEVENLABS_API_KEY});else if(req.method==="POST"&&u.pathname==="/api/analyze")await analyze(req,res);else if(req.method==="POST"&&u.pathname==="/api/grade")await gradeQuiz(req,res);else if(req.method==="POST"&&u.pathname==="/api/speak")await speak(req,res);else if(req.method==="GET"||req.method==="HEAD")await asset(res,u.pathname);else json(res,404,{error:"Not found"})}).listen(port,host,()=>console.log("SNOR is ready at http://"+host+":"+port));