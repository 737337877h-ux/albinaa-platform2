import React from 'react';
import { AccountsScreen } from './customers';

export default function AdvancesScreen(props: any) {
  return <AccountsScreen {...props} kind="advance" />;
}
