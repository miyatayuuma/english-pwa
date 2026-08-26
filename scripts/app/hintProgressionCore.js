export const READ_HINT_STAGE_HIDDEN=0;
export const READ_HINT_STAGE_CLOZE=1;
export const READ_HINT_STAGE_FULL=2;

export function inferReadHintStage({concealed=false,japaneseVisible=false}={}){
  if(concealed) return READ_HINT_STAGE_HIDDEN;
  if(japaneseVisible) return READ_HINT_STAGE_FULL;
  return READ_HINT_STAGE_CLOZE;
}

export function readHintCopy(stage){
  if(stage===READ_HINT_STAGE_HIDDEN){
    return {
      label:'英文非表示',
      placeholder:'…',
      footer:'',
    };
  }
  if(stage===READ_HINT_STAGE_CLOZE){
    return {
      label:'虫食い',
      placeholder:'',
      footer:'',
    };
  }
  return {
    label:'全文表示',
    placeholder:'',
    footer:'',
  };
}
