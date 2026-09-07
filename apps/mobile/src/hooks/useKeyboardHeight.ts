import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * 열려 있는 키보드의 높이를 돌려줍니다. 닫혀 있으면 0입니다.
 *
 * 안드로이드가 edge-to-edge로 그려지면서 windowSoftInputMode="adjustResize"가
 * 더는 창을 줄여주지 않습니다. 그래서 화면 아래에 붙는 시트는 키보드가 올라와도
 * 제자리에 있고, 정작 입력하려던 칸이 키보드에 가려집니다.
 * 높이를 직접 받아 그만큼 띄웁니다.
 */
export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    // iOS는 will 이벤트가 키보드 애니메이션과 같이 와서 따라 움직이고,
    // 안드로이드는 did 이벤트만 발생합니다.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return keyboardHeight;
}
