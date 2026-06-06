require('dotenv').config();
const express=require('express');
const cors = require('cors');
const app=express();

const port=process.env.PORT||3000;
app.use(express.json());
app.use(cors());

const home_router=require('./routes/home_routes.js');
const auth_router=require('./routes/auth_routes.js');
app.use('/auth',auth_router);

app.get('/',(req,res)=>{
    res.send('HEllO APP');
});

app.listen(port,()=>{
    console.log(`listening on port ${port}`);
    
});
