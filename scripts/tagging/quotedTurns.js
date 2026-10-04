export function extractQuotedTurns(text){
  const source=String(text||'');
  const turns=[];
  const regex=/"([^"]+)"/g;
  let match;
  while((match=regex.exec(source))){
    turns.push({
      index:turns.length,
      start:match.index,
      end:match.index+match[0].length,
      contentStart:match.index+1,
      contentEnd:match.index+match[0].length-1,
      text:match[1].trim(),
    });
  }
  return turns;
}

export function quotedTurnContainingSpan(text,start,end){
  const from=Number(start),to=Number(end);
  if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from) return null;
  const matches=extractQuotedTurns(text).filter(turn=>from>=turn.contentStart&&to<=turn.contentEnd);
  return matches.length===1?matches[0]:null;
}
