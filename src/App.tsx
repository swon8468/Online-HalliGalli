import { lazy, Suspense } from 'react'
import { Route, Routes, useSearchParams } from 'react-router-dom'
import ProtectedRoute from './auth/ProtectedRoute'
import ActiveSessionRoute from './auth/ActiveSessionRoute'
import Layout from './components/Layout'
import RouteLoading from './components/RouteLoading'
import Home from './pages/Home'
import Auth from './pages/Auth'
import PasswordRecovery from './pages/PasswordRecovery'
import RecoverySent from './pages/RecoverySent'

const AdminApp = lazy(() => import('./admin/AdminApp'))
const CreateRoom = lazy(() => import('./pages/CreateRoom'))
const Friends = lazy(() => import('./pages/Friends'))
const Game = lazy(() => import('./pages/Game'))
const JoinRoom = lazy(() => import('./pages/JoinRoom'))
const Online = lazy(() => import('./pages/Online'))
const Practice = lazy(() => import('./pages/Practice'))
const Rules = lazy(() => import('./pages/Rules'))
const RoomLobby = lazy(() => import('./pages/RoomLobby'))
const Account = lazy(() => import('./pages/Account'))
const Spaces = lazy(() => import('./pages/Spaces'))
const SpaceAdmin = lazy(() => import('./pages/SpaceAdmin'))
const CardSets = lazy(() => import('./pages/CardSets'))
const CardDesigner = lazy(() => import('./pages/CardDesigner'))
const NotFound = lazy(() => import('./pages/NotFound'))

function GameAccessRoute() {
  const [searchParams] = useSearchParams()
  return searchParams.get('mode') === 'bot' ? <Game /> : <ProtectedRoute><Game /></ProtectedRoute>
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="auth" element={<Auth />} />
          <Route path="recover" element={<PasswordRecovery />} />
          <Route path="recover/sent" element={<RecoverySent />} />
          <Route path="create" element={<ProtectedRoute><ActiveSessionRoute><CreateRoom /></ActiveSessionRoute></ProtectedRoute>} />
          <Route path="join" element={<ProtectedRoute><ActiveSessionRoute><JoinRoom /></ActiveSessionRoute></ProtectedRoute>} />
          <Route path="online" element={<ProtectedRoute><ActiveSessionRoute><Online /></ActiveSessionRoute></ProtectedRoute>} />
          <Route path="practice" element={<Practice />} />
          <Route path="rules" element={<Rules />} />
          <Route path="friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
          <Route path="account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
          <Route path="spaces" element={<ProtectedRoute><Spaces /></ProtectedRoute>} />
          <Route path="spaces/:slug/admin" element={<ProtectedRoute><SpaceAdmin /></ProtectedRoute>} />
          <Route path="cards" element={<ProtectedRoute><CardSets /></ProtectedRoute>} />
          <Route path="cards/:cardSetId" element={<ProtectedRoute><CardDesigner /></ProtectedRoute>} />
          <Route path="game" element={<GameAccessRoute />} />
          <Route path="room/:roomId" element={<ProtectedRoute><RoomLobby /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="admin/*" element={<AdminApp embedded />} />
      </Routes>
    </Suspense>
  )
}
