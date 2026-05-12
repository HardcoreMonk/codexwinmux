package com.hardcoremonk.codexwinmux;

final class CodexmuxLifecycleScript {
    private CodexmuxLifecycleScript() {}

    static String lifecycleGuard() {
        return "(function(){"
            + "var cap=window.Capacitor;"
            + "if(!cap){cap=window.Capacitor={};}"
            + "if(typeof cap.triggerEvent==='function')return;"
            + "cap.triggerEvent=function(eventName,target,eventData){"
            + "var event;"
            + "if(typeof Event==='function'){event=new Event(eventName,{bubbles:false,cancelable:false});}"
            + "else{event=document.createEvent('Events');event.initEvent(eventName,false,false);}"
            + "eventData=eventData||{};"
            + "for(var key in eventData){if(Object.prototype.hasOwnProperty.call(eventData,key)){event[key]=eventData[key];}}"
            + "if(target==='window'){return window.dispatchEvent(event);}"
            + "if(target==='document'){return document.dispatchEvent(event);}"
            + "var targetEl=document.querySelector(target);"
            + "return targetEl?targetEl.dispatchEvent(event):false;"
            + "};"
            + "})();";
    }

    static String nativeAppState(boolean active) {
        return lifecycleGuard() + "window.dispatchEvent(new CustomEvent('codexmux:native-app-state',{detail:{active:" + active + "}}));";
    }
}
