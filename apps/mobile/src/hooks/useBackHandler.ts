import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * 안드로이드 하드웨어 뒤로가기를 가로챕니다.
 *
 * RN Modal은 onRequestClose로 알아서 처리되지만, 절대 위치 View로 띄운
 * 오버레이는 뒤로가기가 그대로 앱 종료로 이어집니다.
 * 화면 위에 뭔가 떠 있으면 그것부터 닫히는 게 맞습니다.
 */
export function useBackHandler(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true; // 기본 동작(앱 종료) 차단
    });
    return () => subscription.remove();
  }, [active, onBack]);
}
