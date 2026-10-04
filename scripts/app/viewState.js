export const VIEW_HOME='home';
export const VIEW_STUDYING='studying';
export const VIEW_REVIEW_COMPLETE='review-complete';

export function createViewStateController({ el, initialView=VIEW_HOME }={}){
  let currentViewState=initialView;

  function applyViewState(nextView){
    const view=(nextView===VIEW_STUDYING || nextView===VIEW_REVIEW_COMPLETE) ? nextView : VIEW_HOME;
    currentViewState=view;
    if(el?.homeView){ el.homeView.hidden=view!==VIEW_HOME; }
    if(el?.studyView){ el.studyView.hidden=view!==VIEW_STUDYING; }
    if(el?.reviewCompleteView){ el.reviewCompleteView.hidden=view!==VIEW_REVIEW_COMPLETE; }
    if(el?.app){
      el.app.dataset.viewState=view;
    }
    return view;
  }

  return {
    applyViewState,
    getCurrentViewState:()=>currentViewState,
    VIEW_HOME,
    VIEW_STUDYING,
    VIEW_REVIEW_COMPLETE,
  };
}
