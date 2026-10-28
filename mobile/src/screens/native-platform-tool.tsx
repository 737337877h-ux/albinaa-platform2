import React from 'react';
import {useAuth} from '../store/auth-context';
import {platformTools} from '../utils/platform-tools';
import {ToolPage,ToolText} from '../components/native-tools';
import AssignHrTask from './assign-hr-task';
import NativeBarcode from './native-barcode';
import NativeAssignments from './native-assignments';
import NativeCollectionKpi from './native-collection-kpi';
import {NativeUsers,NativeRoles,NativeCollectors} from './native-administration';
import NewTask from './new-task';
export const nativeToolScreens={AssignHrTask,BarcodeDesign:NativeBarcode,ManageAssignments:NativeAssignments,CollectionKpi:NativeCollectionKpi,ManageUsers:NativeUsers,ManageRoles:NativeRoles,ManageCollectors:NativeCollectors,AssignTask:NewTask};
export default function NativePlatformTool(props:any){const {user}=useAuth(),tool=platformTools.find(t=>t.route===props.route.name);if(!tool||!user?.permissions.includes(tool.permission))return <ToolPage title="غير مصرح"><ToolText>لا تملك صلاحية هذه الشاشة. حدّث الصلاحيات من الإعدادات إذا غيّرها المسؤول.</ToolText></ToolPage>;const Screen=nativeToolScreens[tool.route];return <Screen key={`${user.id}:${tool.route}`} {...props}/>;}
