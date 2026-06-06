const jwt=require('jsonwebtoken');
const bcrypt=require('bcrypt');
const db=require('../db');

const register= async(req,res)=>{
    try{
        const username=req.body.username;
        const password=req.body.password;
        const user=await db.query(
            "SELECT 1 from Users where username=$1",
            [username]
            );
        if(user.rows.length>0){
            return res.status(200).json({"message":"User aready exists"});
        }
        //user not registered
        const hashed_password=await bcrypt.hash(password,10);
        const add_user=await db.query(
            "INSERT INTO user (username,password) values ($1,$2)",
            [username,hashed_password]
        );
        return

    }
    catch(error){
        return res.status(500).json({"message":"error registering user"});
    }
}

const login=async (req,res)=>{
    try{
        const username=req.body.username;
        const password=req.body.password;
        
        const check_user=await db.query(
            "SELECT * from Users where username=$1"
        );
        const user=check_user[0];
        if(!user){
           return res.status(400).json({"message":"Invalid user"});
        }

        const valid_password=await bcrypt.compare(password,user.password);
        if(!valid_password){
           return res.status(400).json({"message":"Incorrect Password"});
        }
        
        const payload={id:user.rows[0][0],username:user.rows[0][1]};
        const key=jwt.sign(payload,process.env.JWT_SECRET,{expiresIn:'1h'});
        res.status(200).json({"message":"Login successful"})    
    }
    catch(error){
        return res.status(500).json({"message":"Error logging in,Try again"});
    }
}

module.exports={register,login};