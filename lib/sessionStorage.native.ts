import 'expo-sqlite/localStorage/install';

// Expo SDK 57 installs SQLite-backed localStorage on Android and iOS.
export const sessionStorage = localStorage;
