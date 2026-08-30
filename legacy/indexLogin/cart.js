let cartItems =
JSON.parse(localStorage.getItem("cart")) || [];



const cartContainer =
document.getElementById("cart-container");

const total =
document.getElementById("total");





function displayCart(){


cartContainer.innerHTML="";


let totalAmount=0;




if(cartItems.length===0){


cartContainer.innerHTML=`

<div class="empty-cart">

<h2>Your Cart is Empty</h2>

<p>Select services to add them here</p>

</div>

`;


total.innerText="₹0";


return;

}




cartItems.forEach((item,index)=>{


totalAmount += Number(item.price);



let div=document.createElement("div");


div.className="cart-item";



div.innerHTML=`

<div>

<h3>${item.name}</h3>

<p>₹${item.price}</p>

</div>


<button class="remove-btn"
onclick="removeItem(${index})">

Remove

</button>

`;



cartContainer.appendChild(div);



});



total.innerText="₹"+totalAmount;



}





function removeItem(index){


cartItems.splice(index,1);



localStorage.setItem(

"cart",

JSON.stringify(cartItems)

);



displayCart();


}







document.getElementById("checkout")
.addEventListener("click",()=>{


if(cartItems.length===0){


alert("Your cart is empty");

return;


}




localStorage.setItem(

"checkoutItems",

JSON.stringify(cartItems)

);



window.location.href="checkout.html";


});






displayCart();