import { Route, Routes, useSearchParams } from 'react-router-dom'
import AdminApp from './admin/AdminApp'
import ProtectedRoute from './auth/ProtectedRoute'
import ActiveSessionRoute from './auth/ActiveSessionRoute'
import Layout from './components/Layout'
import CreateRoom from './pages/CreateRoom'
import Friends from './pages/Friends'
import Game from './pages/Game'
import Home from './pages/Home'
import Auth from './pages/Auth'
import JoinRoom from './pages/JoinRoom'
import Online from './pages/Online'
import Practice from './pages/Practice'
import Rules from './pages/Rules'
import RoomLobby from './pages/RoomLobby'
import Account from './pages/Account'
import PasswordRecovery from './pages/PasswordRecovery'
import RecoverySent from './pages/RecoverySent'
import Spaces from './pages/Spaces'
import SpaceAdmin from './pages/SpaceAdmin'
import CardSets from './pages/CardSets'
import CardDesigner from './pages/CardDesigner'
import NotFound from './pages/NotFound'

function GameAccessRoute() {
  const [searchParams] = useSearchParams()
  return searchParams.get('mode') === 'bot' ? <Game /> : <ProtectedRoute><Game /></ProtectedRoute>
}

export default function App() {
  return (
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
      <Route path="admin" element={<AdminApp />} />
    </Routes>
  )
}
