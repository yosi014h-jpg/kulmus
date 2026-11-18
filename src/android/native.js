// גשר לאפליקציית האנדרואיד: התוסף המקומי Kulmus (שמירה להורדות, הדפסה, קבצים שנפתחו מאפליקציות אחרות)
import { Capacitor, registerPlugin } from '@capacitor/core';

window.KulmusNative = Capacitor.isNativePlatform() ? registerPlugin('Kulmus') : null;
