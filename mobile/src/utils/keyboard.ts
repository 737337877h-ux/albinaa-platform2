import { findNodeHandle, ScrollView, TextInput } from 'react-native';

export function revealInput(
  scrollView: ScrollView | null,
  input: TextInput | null,
  extraOffset = 150,
) {
  if (!input) return;
  input.focus();
  setTimeout(() => {
    const handle = findNodeHandle(input);
    if (handle) scrollView?.scrollResponderScrollNativeHandleToKeyboard(handle, extraOffset, true);
  }, 350);
}
